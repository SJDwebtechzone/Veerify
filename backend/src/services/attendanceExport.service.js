// backend/src/services/attendanceExport.service.js
//
// Generates PDF (.pdf) and Excel (.xlsx) attendance reports for
// Institution and Branch portals.

const PDFDocument = require('pdfkit');
const ExcelJS     = require('exceljs');

function fmtDateDisplay(isoOrDate) {
  if (!isoOrDate) return '—';
  try {
    const d = new Date(isoOrDate);
    if (Number.isNaN(d.getTime())) return String(isoOrDate);
    return d.toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  } catch {
    return String(isoOrDate);
  }
}

function fmtDateTimeDisplay(d = new Date()) {
  try {
    return d.toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
  } catch {
    return d.toISOString();
  }
}

/**
 * Generate Excel (.xlsx) workbook stream/buffer.
 */
async function generateAttendanceExcel({
  institutionName,
  branchName,
  filterDescription,
  records,
  stats,
}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Veerify Platform';
  workbook.lastModifiedBy = 'Veerify Platform';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Attendance Report', {
    pageSetup: { orientation: 'landscape', fitToPage: true },
  });

  // Title Block — spans 7 columns to cover Date / Branch / Batch /
  // Student ID / Student Name / Status / Attendance %.
  sheet.mergeCells('A1:G1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = `${institutionName || 'Veerify Academy'} — Attendance Report`;
  titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE63946' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 36;

  // Subtitle / Filters info
  sheet.mergeCells('A2:G2');
  const subCell = sheet.getCell('A2');
  subCell.value = `Branch: ${branchName || 'All Branches'} | Filters: ${filterDescription} | Generated: ${fmtDateTimeDisplay()}`;
  subCell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF4B5563' } };
  subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
  subCell.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(2).height = 24;

  // Blank row
  sheet.addRow([]);

  // Stats Summary Block
  const total = stats.total || 0;
  const present = stats.present || 0;
  const absent = stats.absent || 0;
  const late = stats.late || 0;
  const leave = stats.leave || 0;
  const pct = total > 0 ? Math.round((present / total) * 100) : 0;

  const statRow1 = sheet.addRow(['Total Marked', 'Present', 'Absent', 'Late', 'Leave']);
  statRow1.font = { bold: true, size: 10, color: { argb: 'FF374151' } };
  statRow1.alignment = { horizontal: 'center' };
  statRow1.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  });

  const statRow2 = sheet.addRow([total, `${present} (${pct}%)`, absent, late, leave]);
  statRow2.font = { bold: true, size: 11 };
  statRow2.alignment = { horizontal: 'center' };
  statRow2.eachCell((cell) => {
    cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  });

  sheet.addRow([]);

  // Table Headers
  const headers = [
    'Date', 'Branch', 'Batch', 'Student ID', 'Student Name',
    'Attendance Status', 'Attendance %',
  ];
  const headerRow = sheet.addRow(headers);
  headerRow.height = 24;
  headerRow.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
    cell.alignment = { horizontal: 'left', vertical: 'middle' };
  });

  // Table Rows
  records.forEach((r) => {
    const statusText = (r.status || 'absent').toUpperCase();
    const pctText = Number.isFinite(r.attendance_percent)
      ? `${r.attendance_percent}%`
      : '—';
    const row = sheet.addRow([
      fmtDateDisplay(r.date),
      r.branch_name || 'Main Institution',
      r.batch_name || '—',
      r.student_id != null ? String(r.student_id) : '—',
      r.student_name || '—',
      statusText,
      pctText,
    ]);

    row.height = 20;
    // Status cell coloring — now in column 6 after Student ID inserted.
    const statusCell = row.getCell(6);
    statusCell.font = { bold: true };
    if (statusText === 'PRESENT') {
      statusCell.font = { bold: true, color: { argb: 'FF065F46' } };
      statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
    } else if (statusText === 'ABSENT') {
      statusCell.font = { bold: true, color: { argb: 'FF991B1B' } };
      statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
    } else if (statusText === 'LATE') {
      statusCell.font = { bold: true, color: { argb: 'FF92400E' } };
      statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
    } else if (statusText === 'LEAVE') {
      statusCell.font = { bold: true, color: { argb: 'FF1E40AF' } };
      statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
    }

    // Attendance % cell — right-align to read as a number.
    const pctCell = row.getCell(7);
    pctCell.alignment = { horizontal: 'right' };
    pctCell.font = { bold: true, color: { argb: 'FF374151' } };

    row.eachCell((cell) => {
      cell.border = {
        top:    { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left:   { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right:  { style: 'thin', color: { argb: 'FFE5E7EB' } },
      };
    });
  });

  // Set Column Widths
  sheet.getColumn(1).width = 14;   // Date
  sheet.getColumn(2).width = 22;   // Branch
  sheet.getColumn(3).width = 22;   // Batch
  sheet.getColumn(4).width = 12;   // Student ID
  sheet.getColumn(5).width = 26;   // Student Name
  sheet.getColumn(6).width = 18;   // Status
  sheet.getColumn(7).width = 14;   // Attendance %

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

/**
 * Generate PDF (.pdf) document stream/buffer.
 */
function generateAttendancePdf({
  institutionName,
  branchName,
  filterDescription,
  records,
  stats,
}) {
  return new Promise((resolve, reject) => {
    // Landscape A4 gives us the width we need for seven columns
    // without truncating Student Name or Batch. bufferPages so the
    // "Page X of Y" footer can be back-filled after the last row.
    const doc = new PDFDocument({
      margin: 36,
      size: 'A4',
      layout: 'landscape',
      bufferPages: true,
    });
    const buffers = [];

    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', (err) => reject(err));

    // A4 landscape page dimensions in PDF points: 842 x 595.
    // Content band: left margin 36 → right margin 36 → usable width 770.
    const pageWidth   = 842;
    const contentX    = 36;
    const contentW    = 770;

    const brandRed = '#E63946';
    const textDark = '#111827';
    const textMuted = '#6B7280';

    // Header Title
    doc.rect(contentX, 36, contentW, 48).fill(brandRed);
    doc.fillColor('#FFFFFF')
       .fontSize(16)
       .font('Helvetica-Bold')
       .text(institutionName || 'Veerify Academy', contentX + 10, 46, { width: contentW - 20, align: 'center' });

    doc.fontSize(10)
       .font('Helvetica')
       .text('Attendance Report', contentX + 10, 66, { width: contentW - 20, align: 'center' });

    // Meta Block — Branch / Filters / Generated. Report generation
    // datetime is required by spec; branchName carries the caller's
    // branch (or "All Branches" for main admin).
    doc.fillColor(textDark)
       .fontSize(9)
       .font('Helvetica-Bold')
       .text(`Branch: `, contentX, 96, { continued: true })
       .font('Helvetica')
       .text(branchName || 'All Branches', { continued: true })
       .font('Helvetica-Bold')
       .text(`   |   Filters: `, { continued: true })
       .font('Helvetica')
       .text(filterDescription, { continued: true })
       .font('Helvetica-Bold')
       .text(`   |   Generated: `, { continued: true })
       .font('Helvetica')
       .text(fmtDateTimeDisplay());

    // Summary Box
    const total = stats.total || 0;
    const present = stats.present || 0;
    const absent = stats.absent || 0;
    const late = stats.late || 0;
    const leave = stats.leave || 0;
    const pct = total > 0 ? Math.round((present / total) * 100) : 0;

    doc.rect(contentX, 114, contentW, 34).fill('#F3F4F6');
    doc.fillColor(textDark)
       .fontSize(9)
       .font('Helvetica-Bold')
       .text(`Summary:  `, contentX + 10, 126, { continued: true })
       .font('Helvetica')
       .text(`Total Marked: ${total}   |   Present: ${present} (${pct}%)   |   Absent: ${absent}   |   Late: ${late}   |   Leave: ${leave}`);

    // Table Setup — 7 columns tuned for A4 landscape usable width 770.
    //   Date · Branch · Batch · Student ID · Student Name · Status · %
    let y = 160;
    const colX = [36, 116, 240, 360, 430, 620, 720];
    const colW = [ 80, 124, 120,  70, 190, 100,  86];

    function drawTableHeader() {
      doc.rect(contentX, y, contentW, 20).fill('#1F2937');
      doc.fillColor('#FFFFFF').fontSize(9).font('Helvetica-Bold');
      doc.text('Date',         colX[0] + 4, y + 5);
      doc.text('Branch',       colX[1] + 4, y + 5);
      doc.text('Batch',        colX[2] + 4, y + 5);
      doc.text('Student ID',   colX[3] + 4, y + 5);
      doc.text('Student Name', colX[4] + 4, y + 5);
      doc.text('Status',       colX[5] + 4, y + 5);
      doc.text('%',            colX[6] + 4, y + 5);
      y += 20;
    }

    drawTableHeader();

    doc.font('Helvetica').fontSize(8.5);

    // Bottom threshold for a new page — landscape height is 595, leave
    // 40pt for the page-number footer.
    const pageBottom = 540;

    records.forEach((r, index) => {
      if (y > pageBottom) {
        doc.addPage();
        y = 36;
        drawTableHeader();
        doc.font('Helvetica').fontSize(8.5);
      }

      const bgRow = index % 2 === 0 ? '#FFFFFF' : '#F9FAFB';
      doc.rect(contentX, y, contentW, 18).fill(bgRow);

      const statusText = (r.status || 'absent').toUpperCase();
      let statusColor = '#374151';
      if (statusText === 'PRESENT') statusColor = '#065F46';
      else if (statusText === 'ABSENT') statusColor = '#991B1B';
      else if (statusText === 'LATE') statusColor = '#92400E';
      else if (statusText === 'LEAVE') statusColor = '#1E40AF';

      doc.fillColor(textDark);
      doc.text(fmtDateDisplay(r.date), colX[0] + 4, y + 4, { width: colW[0] - 8, lineBreak: false });
      doc.text(r.branch_name || 'Main Institution', colX[1] + 4, y + 4, { width: colW[1] - 8, lineBreak: false });
      doc.text(r.batch_name || '—', colX[2] + 4, y + 4, { width: colW[2] - 8, lineBreak: false });
      doc.text(r.student_id != null ? String(r.student_id) : '—', colX[3] + 4, y + 4, { width: colW[3] - 8, lineBreak: false });
      doc.text(r.student_name || '—', colX[4] + 4, y + 4, { width: colW[4] - 8, lineBreak: false });

      doc.fillColor(statusColor).font('Helvetica-Bold');
      doc.text(statusText, colX[5] + 4, y + 4, { width: colW[5] - 8, lineBreak: false });

      const pctText = Number.isFinite(r.attendance_percent)
        ? `${r.attendance_percent}%`
        : '—';
      doc.fillColor(textDark);
      doc.text(pctText, colX[6] + 4, y + 4, { width: colW[6] - 8, align: 'right', lineBreak: false });
      doc.font('Helvetica');

      y += 18;
    });

    // Footers with page numbers — landscape footer sits at y=570.
    const totalPages = doc.bufferedPageRange().count;
    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(i);
      doc.fillColor(textMuted)
         .fontSize(8)
         .font('Helvetica')
         .text(
           `Page ${i + 1} of ${totalPages}   •   Veerify Attendance Report`,
           contentX, 570, { width: contentW, align: 'center' },
         );
    }

    doc.end();
  });
}

module.exports = {
  generateAttendanceExcel,
  generateAttendancePdf,
};
