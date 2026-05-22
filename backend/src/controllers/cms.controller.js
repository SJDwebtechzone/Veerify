const pool = require('../config/db');

/**
 * Generic CMS table helper. Each resource has the same CRUD shape
 * (list / get / create / update / delete) so we factor it once.
 *
 * `table`  - the postgres table name
 * `cols`   - allowed column names that can be inserted / updated
 * `dateCols` - subset of `cols` that should be coerced to dates / nulls
 */
function makeCrud({ table, cols, dateCols = [] }) {
  const sanitize = (body) => {
    const out = {};
    for (const c of cols) {
      if (body[c] === undefined) continue;
      let val = body[c];
      if (dateCols.includes(c)) {
        if (val === '' || val === null) val = null;
      }
      out[c] = val;
    }
    return out;
  };

  return {
    list: async (req, res) => {
      try {
        const { active } = req.query;
        let sql = `SELECT * FROM ${table}`;
        const params = [];
        if (active === 'true') {
          sql += ' WHERE is_active = true';
        }
        sql += ' ORDER BY sort_order ASC, id ASC';
        const result = await pool.query(sql, params);
        res.json({ items: result.rows });
      } catch (err) {
        console.error(`List ${table} error:`, err);
        res.status(500).json({ message: 'Server error', error: err.message });
      }
    },

    create: async (req, res) => {
      try {
        const data = sanitize(req.body);
        const keys = Object.keys(data);
        if (keys.length === 0) {
          return res.status(400).json({ message: 'No valid fields supplied' });
        }
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
        const values = keys.map((k) => data[k]);

        // Auto-assign sort_order if not supplied
        if (!keys.includes('sort_order')) {
          const max = await pool.query(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM ${table}`);
          keys.push('sort_order');
          values.push(max.rows[0].m + 1);
        }

        const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`;
        const result = await pool.query(sql, values);
        res.status(201).json({ item: result.rows[0] });
      } catch (err) {
        console.error(`Create ${table} error:`, err);
        res.status(500).json({ message: 'Server error', error: err.message });
      }
    },

    update: async (req, res) => {
      try {
        const { id } = req.params;
        const data = sanitize(req.body);
        const keys = Object.keys(data);
        if (keys.length === 0) {
          return res.status(400).json({ message: 'No valid fields supplied' });
        }
        const setSql = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
        const values = keys.map((k) => data[k]);
        values.push(id);
        const sql = `UPDATE ${table} SET ${setSql}, updated_at = CURRENT_TIMESTAMP WHERE id = $${values.length} RETURNING *`;
        const result = await pool.query(sql, values);
        if (result.rows.length === 0) return res.status(404).json({ message: 'Not found' });
        res.json({ item: result.rows[0] });
      } catch (err) {
        console.error(`Update ${table} error:`, err);
        res.status(500).json({ message: 'Server error', error: err.message });
      }
    },

    remove: async (req, res) => {
      try {
        const { id } = req.params;
        const result = await pool.query(`DELETE FROM ${table} WHERE id = $1 RETURNING id`, [id]);
        if (result.rows.length === 0) return res.status(404).json({ message: 'Not found' });
        res.json({ ok: true, deletedId: result.rows[0].id });
      } catch (err) {
        console.error(`Delete ${table} error:`, err);
        res.status(500).json({ message: 'Server error', error: err.message });
      }
    },

    reorder: async (req, res) => {
      try {
        const { order } = req.body; // array of ids in desired order
        if (!Array.isArray(order)) return res.status(400).json({ message: 'order array required' });
        for (let i = 0; i < order.length; i += 1) {
          await pool.query(`UPDATE ${table} SET sort_order = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [i + 1, order[i]]);
        }
        const result = await pool.query(`SELECT * FROM ${table} ORDER BY sort_order ASC, id ASC`);
        res.json({ items: result.rows });
      } catch (err) {
        console.error(`Reorder ${table} error:`, err);
        res.status(500).json({ message: 'Server error', error: err.message });
      }
    },
  };
}

const banners = makeCrud({
  table: 'mobile_banners',
  cols: ['label', 'title', 'subtitle', 'cta', 'image_url', 'is_active', 'sort_order'],
});

const categories = makeCrud({
  table: 'mobile_categories',
  cols: ['name', 'image_url', 'is_active', 'sort_order'],
});

const videos = makeCrud({
  table: 'mobile_videos',
  cols: ['title', 'trainer', 'duration', 'video_url', 'thumbnail_url', 'is_free', 'is_active', 'sort_order'],
});

const events = makeCrud({
  table: 'mobile_events',
  cols: [
    'title', 'subtitle', 'image_url', 'link',
    'location', 'event_date', 'registration_closing_date',
    'is_active', 'sort_order',
  ],
  dateCols: ['event_date', 'registration_closing_date'],
});

module.exports = { banners, categories, videos, events };
