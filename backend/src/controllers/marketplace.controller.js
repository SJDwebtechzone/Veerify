const pool = require('../config/db');

// GET /api/marketplace-settings
exports.getMarketplaceSettings = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM marketplace_settings WHERE id = 1');
    if (result.rows.length === 0) {
      // Fallback fallback if not populated
      return res.json({
        settings: {
          commission_percent: 10.00,
          gateway_bearer: 'Institution',
          min_payout: 1000.00,
          settlement_cycle: 'Weekly',
          auto_settlement: false,
        }
      });
    }
    res.json({ settings: result.rows[0] });
  } catch (err) {
    console.error('Get marketplace settings error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// PUT /api/marketplace-settings
exports.updateMarketplaceSettings = async (req, res) => {
  try {
    const {
      commission_percent,
      gateway_bearer,
      min_payout,
      settlement_cycle,
      auto_settlement,
    } = req.body;

    // Normalization & Parsing
    const commission = parseFloat(commission_percent);
    const minPayoutVal = parseFloat(min_payout);
    const bearer = (gateway_bearer || '').trim();
    const cycle = (settlement_cycle || '').trim();
    const autoSett = !!auto_settlement;

    // Validations
    if (isNaN(commission) || commission < 0 || commission > 100) {
      return res.status(400).json({ message: 'Commission percentage must be between 0 and 100' });
    }
    if (isNaN(minPayoutVal) || minPayoutVal < 0) {
      return res.status(400).json({ message: 'Minimum payout amount cannot be negative' });
    }
    if (!['Daily', 'Weekly', 'Monthly'].includes(cycle)) {
      return res.status(400).json({ message: 'Settlement cycle is required and must be Daily, Weekly, or Monthly' });
    }
    if (!['Platform', 'Institution'].includes(bearer)) {
      return res.status(400).json({ message: 'Gateway bearer is required and must be Platform or Institution' });
    }

    const result = await pool.query(
      `UPDATE marketplace_settings
       SET commission_percent = $1,
           gateway_bearer = $2,
           min_payout = $3,
           settlement_cycle = $4,
           auto_settlement = $5,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = 1
       RETURNING *`,
      [commission, bearer, minPayoutVal, cycle, autoSett]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Marketplace settings not found' });
    }

    res.json({ message: 'Marketplace settings updated', settings: result.rows[0] });
  } catch (err) {
    console.error('Update marketplace settings error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
