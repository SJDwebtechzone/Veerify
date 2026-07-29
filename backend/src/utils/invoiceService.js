// backend/src/utils/invoiceService.js
//
// Generates a PDF invoice, persists the row, and (best-effort) emails
// the PDF to the payer. Idempotent — if a matching invoice already
// exists for the given enrollment / subscription payment we return
// that row instead of re-generating a duplicate.
//
// Two entry points, one per payment kind:
//
//   • generateEnrollmentInvoice({ enrollmentId })
//   • generateSubscriptionInvoice({ institutionId, paymentReference,
//                                    amount, planName })
//
// Both return { ok, invoice } or { ok: false, error }. Never throws
// so a PDF hiccup or SMTP outage can't break the webhook handler.

const fs   = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const { sendMail } = require('./mailer');

// Latched at the first 42P01 that names the `invoices` table, which
// means migration 063_invoices.sql hasn't been applied on this DB.
// Once flipped, both public entry points short-circuit and return
// `{ ok: false, skipped: 'invoices-table-missing' }` so the callers'
// fire-and-forget catches log one clean line per request instead of
// a fresh stack trace. A process restart re-checks the schema.
let invoicesTableMissing = false;
function isInvoicesTableMissing(err) {
  return err?.code === '42P01'
      && /"?invoices"?/i.test(err?.message || '');
}
function noteInvoicesTableMissing(where) {
  if (invoicesTableMissing) return;
  invoicesTableMissing = true;
  console.warn(
    `[invoiceService] ${where}: invoices table missing — migration 063_invoices.sql has not been applied. `
    + 'PDF invoice generation is disabled. Run `npm run migrate -- src/db/migrations/063_invoices.sql` and restart the server.',
  );
}

// Where the rendered PDFs live. Served by the existing static /uploads
// route in server.js. Everything under this dir is public — the auth
// gate is enforced by the /api/invoices/:id/pdf controller before it
// streams the file, so a raw /uploads/... URL guessed from outside
// won't match a real invoice.
const INVOICE_DIR = path.join(__dirname, '..', '..', 'uploads', 'invoices');

function ensureInvoiceDir() {
  if (!fs.existsSync(INVOICE_DIR)) {
    fs.mkdirSync(INVOICE_DIR, { recursive: true });
  }
}

// Mint the next invoice number for the current calendar year. Uses a
// count of existing rows to keep collisions minimal without a
// dedicated sequence table. Padded to 6 digits so the string sorts.
async function nextInvoiceNumber() {
  const year = new Date().getFullYear();
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM invoices
      WHERE number LIKE $1`,
    [`VRF-INV-${year}-%`],
  );
  const seq = String((r.rows[0]?.n || 0) + 1).padStart(6, '0');
  return `VRF-INV-${year}-${seq}`;
}

// Standard money format used everywhere in the invoice.
function inr(n) {
  const v = Number(n) || 0;
  return `INR ${v.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// Draws the PDF. All layout is in a single function so tweaks stay
// close to the render. Uses pdfkit's built-in Helvetica so the file
// works without shipping any font assets.
function renderInvoicePdf({
  filePath, invoiceNumber, issuedAt,
  payerName, payerEmail, itemDescription,
  subtotal, tax, total,
  paymentMethod, paymentReference,
  brandName = 'Veerify',
  brandTagline = 'Martial arts academy management, made simple.',
  supportEmail,
}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 44 });
    const out = fs.createWriteStream(filePath);
    out.on('finish', () => resolve());
    out.on('error', reject);
    doc.pipe(out);

    // ── Header — brand + invoice number ─────────────────────────
    doc.fontSize(20).fillColor('#111827').text(brandName, { continued: false });
    doc.fontSize(9).fillColor('#6B7280').text(brandTagline);
    doc.moveDown(0.8);

    // Top-right block — invoice label + number + date
    const rightX = 380;
    doc.save();
    doc.fontSize(9).fillColor('#6B7280');
    doc.text('INVOICE', rightX, 44, { width: 160, align: 'right' });
    doc.fillColor('#111827').fontSize(11).text(invoiceNumber, rightX, 58, {
      width: 160, align: 'right',
    });
    doc.fillColor('#6B7280').fontSize(9).text(
      `Issued: ${new Date(issuedAt).toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
      })}`,
      rightX, 76, { width: 160, align: 'right' },
    );
    doc.restore();

    // Divider
    doc.strokeColor('#E5E7EB').lineWidth(1)
       .moveTo(44, 120).lineTo(551, 120).stroke();

    // ── Bill-to block ───────────────────────────────────────────
    doc.moveDown(2);
    doc.fontSize(9).fillColor('#6B7280').text('BILL TO', 44, 140);
    doc.fontSize(12).fillColor('#111827').text(payerName || '—', 44, 154);
    if (payerEmail) {
      doc.fontSize(10).fillColor('#4B5563').text(payerEmail, 44, 172);
    }

    // ── Item table ──────────────────────────────────────────────
    let y = 220;
    // Header row
    doc.rect(44, y, 507, 24).fillColor('#F9FAFB').fill();
    doc.fillColor('#374151').fontSize(9);
    doc.text('DESCRIPTION',      54, y + 8, { width: 340 });
    doc.text('AMOUNT', 400, y + 8, { width: 141, align: 'right' });
    y += 32;

    // Body row — single item line
    doc.fillColor('#111827').fontSize(11);
    doc.text(itemDescription || 'Payment', 54, y, { width: 340 });
    doc.text(inr(subtotal), 400, y, { width: 141, align: 'right' });
    y += 40;

    // Divider
    doc.strokeColor('#E5E7EB').lineWidth(1)
       .moveTo(44, y).lineTo(551, y).stroke();
    y += 12;

    // Subtotal / tax / total block
    const labelX = 340;
    const valueX = 400;
    doc.fontSize(10).fillColor('#4B5563');
    doc.text('Subtotal',   labelX, y, { width: 60 });
    doc.text(inr(subtotal), valueX, y, { width: 141, align: 'right' });
    y += 18;
    doc.text('Tax (GST)',  labelX, y, { width: 60 });
    doc.text(inr(tax),      valueX, y, { width: 141, align: 'right' });
    y += 22;
    doc.fontSize(12).fillColor('#111827');
    doc.text('Total',      labelX, y, { width: 60 });
    doc.fontSize(14).text(inr(total), valueX, y - 3, { width: 141, align: 'right' });
    y += 34;

    // ── Payment provenance ──────────────────────────────────────
    doc.fontSize(9).fillColor('#6B7280');
    doc.text('PAYMENT', 44, y);
    y += 12;
    doc.fontSize(10).fillColor('#111827')
       .text(`Method: ${paymentMethod || 'Razorpay'}`, 44, y);
    y += 14;
    if (paymentReference) {
      doc.fontSize(10).fillColor('#111827')
         .text(`Reference: ${paymentReference}`, 44, y);
      y += 14;
    }

    // ── Footer ──────────────────────────────────────────────────
    doc.fontSize(8).fillColor('#9CA3AF').text(
      supportEmail
        ? `Questions about this invoice? Reach out to ${supportEmail}.`
        : 'Thank you for your payment.',
      44, 780, { width: 507, align: 'center' },
    );
    doc.text('This is a system-generated invoice and requires no signature.', 44, 795, {
      width: 507, align: 'center',
    });

    doc.end();
  });
}

// ── Public: enrollment invoice ────────────────────────────────────
async function generateEnrollmentInvoice({ enrollmentId }) {
  // Fast-path when migration 063 hasn't been applied yet.
  if (invoicesTableMissing) {
    return { ok: false, skipped: 'invoices-table-missing' };
  }
  try {
    if (!Number.isInteger(enrollmentId)) {
      return { ok: false, error: 'Invalid enrollment id' };
    }
    // Idempotency — if we already have an invoice for this
    // enrollment, return it instead of generating a new one.
    const existing = await pool.query(
      `SELECT * FROM invoices WHERE enrollment_id = $1`, [enrollmentId],
    );
    if (existing.rows.length > 0) {
      return { ok: true, invoice: existing.rows[0], reused: true };
    }

    // Load the enrolment + related metadata.
    const r = await pool.query(
      `SELECT e.id, e.payment_amount, e.payment_mode, e.payment_reference,
              e.institution_id,
              c.name AS course_name,
              c.billing_cycle AS course_billing_cycle,
              i.name AS institution_name,
              u.name AS student_name, u.email AS student_email
         FROM enrollments e
         JOIN batches b       ON b.id = e.batch_id
         JOIN courses c       ON c.id = b.course_id
         JOIN institutions i  ON i.id = e.institution_id
         JOIN users u         ON u.id = e.student_id
        WHERE e.id = $1`,
      [enrollmentId],
    );
    if (r.rows.length === 0) return { ok: false, error: 'Enrollment not found' };
    const row = r.rows[0];

    ensureInvoiceDir();
    const invoiceNumber = await nextInvoiceNumber();
    const filename = `${invoiceNumber}.pdf`;
    const pdfPath  = path.join(INVOICE_DIR, filename);

    const amount = Number(row.payment_amount) || 0;
    // Simple 0% tax split — the flag is here so future rows can carry
    // a real GST breakdown. Institutions that need real GST invoices
    // typically override the tax rate at the admin dashboard later.
    const tax      = 0;
    const subtotal = amount - tax;

    // Shared billing-cycle label — mirrors the wording shown on the
    // mobile payment summary and on the Razorpay hosted checkout page
    // so the invoice matches what the payer just saw.
    const { billingCycleLabel } = require('./billingCycle');
    const cycleLabel = billingCycleLabel(row.course_billing_cycle);

    await renderInvoicePdf({
      filePath:        pdfPath,
      invoiceNumber,
      issuedAt:        new Date(),
      payerName:       row.student_name,
      payerEmail:      row.student_email,
      itemDescription:
        `${row.course_name} — ${cycleLabel} (${row.institution_name})`,
      subtotal,
      tax,
      total:           amount,
      paymentMethod:   row.payment_mode
        ? row.payment_mode.toUpperCase()
        : 'Razorpay',
      paymentReference: row.payment_reference,
      supportEmail:     process.env.SUPPORT_EMAIL,
    });

    const relPath = `/uploads/invoices/${filename}`;
    const ins = await pool.query(
      `INSERT INTO invoices
         (number, kind, enrollment_id, institution_id,
          payer_name, payer_email, item_description,
          subtotal_amount, tax_amount, total_amount, currency,
          payment_method, payment_reference, pdf_path)
       VALUES ($1, 'enrollment', $2, $3, $4, $5, $6, $7, $8, $9, 'INR', $10, $11, $12)
       RETURNING *`,
      [
        invoiceNumber,
        row.id,
        row.institution_id,
        row.student_name || null,
        row.student_email || null,
        `${row.course_name} — ${cycleLabel}`,
        subtotal, tax, amount,
        row.payment_mode || 'razorpay',
        row.payment_reference,
        relPath,
      ],
    );
    const invoice = ins.rows[0];

    // Fire-and-forget email with the PDF attached.
    if (row.student_email) {
      const mail = await sendMail({
        to:      row.student_email,
        subject: `Your invoice ${invoiceNumber} — ${row.institution_name}`,
        text:
          `Hi ${row.student_name || 'there'},\n\n` +
          `Thanks for your payment. Your invoice for ${row.course_name} is attached.\n\n` +
          `Amount: ${inr(amount)}\n` +
          `Reference: ${row.payment_reference || '—'}\n\n` +
          `Veerify`,
        html:
          `<p>Hi ${row.student_name || 'there'},</p>` +
          `<p>Thanks for your payment. Your invoice for <b>${row.course_name}</b> is attached.</p>` +
          `<p><b>Amount:</b> ${inr(amount)}<br/>` +
          `<b>Reference:</b> ${row.payment_reference || '—'}</p>` +
          `<p>— Veerify</p>`,
        attachments: [{ filename, path: pdfPath }],
      }).catch(() => ({ ok: false }));
      if (mail.ok) {
        await pool.query(
          `UPDATE invoices SET emailed_at = NOW() WHERE id = $1`, [invoice.id],
        );
        invoice.emailed_at = new Date();
      }
    }

    return { ok: true, invoice };
  } catch (err) {
    if (isInvoicesTableMissing(err)) {
      noteInvoicesTableMissing('enrollment invoice');
      return { ok: false, skipped: 'invoices-table-missing' };
    }
    console.error('[invoiceService] enrollment invoice failed:', err);
    return { ok: false, error: err?.message || 'Invoice generation failed' };
  }
}

// ── Public: subscription invoice ──────────────────────────────────
async function generateSubscriptionInvoice({
  institutionId, paymentReference, amount, planName,
}) {
  if (invoicesTableMissing) {
    return { ok: false, skipped: 'invoices-table-missing' };
  }
  try {
    if (!Number.isInteger(institutionId)) {
      return { ok: false, error: 'Invalid institution id' };
    }
    // Idempotency — one invoice per subscription payment reference.
    const existing = await pool.query(
      `SELECT * FROM invoices
        WHERE kind = 'subscription' AND payment_reference = $1`,
      [paymentReference],
    );
    if (existing.rows.length > 0) {
      return { ok: true, invoice: existing.rows[0], reused: true };
    }

    const r = await pool.query(
      `SELECT i.id, i.name,
              u.name AS owner_name, u.email AS owner_email
         FROM institutions i
         JOIN users u ON u.id = i.owner_user_id
        WHERE i.id = $1`,
      [institutionId],
    );
    if (r.rows.length === 0) return { ok: false, error: 'Institution not found' };
    const row = r.rows[0];

    ensureInvoiceDir();
    const invoiceNumber = await nextInvoiceNumber();
    const filename = `${invoiceNumber}.pdf`;
    const pdfPath  = path.join(INVOICE_DIR, filename);

    const totalAmount = Number(amount) || 0;
    const tax         = 0;
    const subtotal    = totalAmount - tax;

    await renderInvoicePdf({
      filePath:        pdfPath,
      invoiceNumber,
      issuedAt:        new Date(),
      payerName:       row.owner_name,
      payerEmail:      row.owner_email,
      itemDescription: `${planName || 'Veerify Plan'} subscription — ${row.name}`,
      subtotal,
      tax,
      total:           totalAmount,
      paymentMethod:   'Razorpay',
      paymentReference: paymentReference,
      supportEmail:     process.env.SUPPORT_EMAIL,
    });

    const relPath = `/uploads/invoices/${filename}`;
    const ins = await pool.query(
      `INSERT INTO invoices
         (number, kind, institution_id,
          payer_name, payer_email, item_description,
          subtotal_amount, tax_amount, total_amount, currency,
          payment_method, payment_reference, pdf_path)
       VALUES ($1, 'subscription', $2, $3, $4, $5, $6, $7, $8, 'INR', 'razorpay', $9, $10)
       RETURNING *`,
      [
        invoiceNumber,
        row.id,
        row.owner_name || null,
        row.owner_email || null,
        `${planName || 'Veerify Plan'} subscription`,
        subtotal, tax, totalAmount,
        paymentReference,
        relPath,
      ],
    );
    const invoice = ins.rows[0];

    if (row.owner_email) {
      const mail = await sendMail({
        to:      row.owner_email,
        subject: `Your invoice ${invoiceNumber} — ${row.name}`,
        text:
          `Hi ${row.owner_name || 'there'},\n\n` +
          `Thanks for your subscription payment. Your invoice is attached.\n\n` +
          `Plan: ${planName || 'Veerify Plan'}\n` +
          `Amount: ${inr(totalAmount)}\n` +
          `Reference: ${paymentReference || '—'}\n\n` +
          `Veerify`,
        html:
          `<p>Hi ${row.owner_name || 'there'},</p>` +
          `<p>Thanks for your subscription payment. Your invoice is attached.</p>` +
          `<p><b>Plan:</b> ${planName || 'Veerify Plan'}<br/>` +
          `<b>Amount:</b> ${inr(totalAmount)}<br/>` +
          `<b>Reference:</b> ${paymentReference || '—'}</p>` +
          `<p>— Veerify</p>`,
        attachments: [{ filename, path: pdfPath }],
      }).catch(() => ({ ok: false }));
      if (mail.ok) {
        await pool.query(
          `UPDATE invoices SET emailed_at = NOW() WHERE id = $1`, [invoice.id],
        );
        invoice.emailed_at = new Date();
      }
    }

    return { ok: true, invoice };
  } catch (err) {
    if (isInvoicesTableMissing(err)) {
      noteInvoicesTableMissing('subscription invoice');
      return { ok: false, skipped: 'invoices-table-missing' };
    }
    console.error('[invoiceService] subscription invoice failed:', err);
    return { ok: false, error: err?.message || 'Invoice generation failed' };
  }
}

module.exports = {
  generateEnrollmentInvoice,
  generateSubscriptionInvoice,
  INVOICE_DIR,
};
