const pool = require('../config/db');

exports.getPlans = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM subscription_plans 
       WHERE is_active = TRUE 
       ORDER BY price ASC`
    );
    res.json({ plans: result.rows });
  } catch (err) {
    console.error('Get plans error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

exports.getPlanById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT * FROM subscription_plans WHERE id = $1 AND is_active = TRUE',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Plan not found' });
    }
    res.json({ plan: result.rows[0] });
  } catch (err) {
    console.error('Get plan error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};