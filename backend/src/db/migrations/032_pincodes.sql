-- ============================================================================
-- 032_pincodes.sql
-- ----------------------------------------------------------------------------
-- Lookup table that maps an Indian PIN code to its district centroid
-- (latitude / longitude). Powers the student-side "nearby academies"
-- search when the device denies GPS — the student just types a pincode
-- and we run the same haversine query against institutions + branches.
--
-- Scope: TAMIL NADU only for the first cut. The full dataset (~155k rows
-- across India) is published by India Post and several mirrors; an
-- importer script can backfill the rest later. The starter seed below
-- gives us coverage of every Tamil Nadu district HQ + the major sub
-- cities (Chennai zones, Trichy, Madurai, Coimbatore, Salem, etc.), so
-- a student anywhere in TN can type their pincode and the prefix or
-- centroid match will resolve to a sensible nearby search.
-- ============================================================================

CREATE TABLE IF NOT EXISTS pincodes (
  pincode   VARCHAR(6)       PRIMARY KEY,
  latitude  DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  district  VARCHAR(80),
  state     VARCHAR(80),
  -- The first three digits of an Indian pincode identify the postal
  -- "sorting district" — same value generally means the same city.
  -- Stored as a column so the prefix-match fallback can index on it.
  region3   VARCHAR(3)
);

CREATE INDEX IF NOT EXISTS idx_pincodes_region3 ON pincodes (region3);
CREATE INDEX IF NOT EXISTS idx_pincodes_state   ON pincodes (state);

-- ─── Tamil Nadu starter seed ────────────────────────────────────────────
-- One representative pincode per major locality / district HQ. Lat/lng
-- accurate to ~3 decimals (~110 m), which is plenty for "find the
-- nearest academy in your city." Pincode ranges noted on each block.
INSERT INTO pincodes (pincode, latitude, longitude, district, state, region3) VALUES
  -- Chennai metro + suburbs (600xxx, 601xxx)
  ('600001', 13.0827, 80.2707, 'Chennai',           'Tamil Nadu', '600'),
  ('600002', 13.0635, 80.2671, 'Chennai',           'Tamil Nadu', '600'),
  ('600004', 13.0341, 80.2731, 'Chennai',           'Tamil Nadu', '600'),
  ('600017', 13.0418, 80.2341, 'Chennai',           'Tamil Nadu', '600'),
  ('600028', 13.0339, 80.2619, 'Chennai',           'Tamil Nadu', '600'),
  ('600040', 13.0843, 80.2061, 'Chennai',           'Tamil Nadu', '600'),
  ('600041', 12.9510, 80.2606, 'Chennai',           'Tamil Nadu', '600'),
  ('600042', 12.9783, 80.2210, 'Chennai',           'Tamil Nadu', '600'),
  ('600083', 13.0382, 80.1851, 'Chennai',           'Tamil Nadu', '600'),
  ('600119', 12.8746, 80.2240, 'Chennai',           'Tamil Nadu', '600'),
  ('601201', 13.1142, 80.0098, 'Tiruvallur',        'Tamil Nadu', '601'),
  ('602001', 13.0795, 79.9080, 'Tiruvallur',        'Tamil Nadu', '602'),
  ('603001', 12.8185, 80.0436, 'Chengalpattu',      'Tamil Nadu', '603'),
  ('604001', 12.6020, 79.5697, 'Tindivanam',        'Tamil Nadu', '604'),
  -- Northern districts (605–611)
  ('605001', 11.9416, 79.8083, 'Cuddalore',         'Tamil Nadu', '605'),
  ('605602', 12.2266, 79.0710, 'Tiruvannamalai',    'Tamil Nadu', '605'),
  ('606601', 11.9322, 78.1601, 'Dharmapuri',        'Tamil Nadu', '606'),
  ('607001', 11.7458, 79.7702, 'Cuddalore',         'Tamil Nadu', '607'),
  ('608001', 11.3924, 79.6961, 'Chidambaram',       'Tamil Nadu', '608'),
  ('609001', 10.9254, 79.8380, 'Karaikal',          'Puducherry', '609'),
  ('610001', 10.7720, 79.6347, 'Tiruvarur',         'Tamil Nadu', '610'),
  ('611001', 10.7656, 79.8424, 'Nagapattinam',      'Tamil Nadu', '611'),
  -- Central delta (612–625)
  ('612001', 10.7867, 79.1378, 'Thanjavur',         'Tamil Nadu', '612'),
  ('613001', 10.7867, 79.1378, 'Thanjavur',         'Tamil Nadu', '613'),
  ('614001', 10.6063, 79.4000, 'Pattukkottai',      'Tamil Nadu', '614'),
  ('620001', 10.7905, 78.7047, 'Tiruchirappalli',   'Tamil Nadu', '620'),
  ('620017', 10.8500, 78.6868, 'Tiruchirappalli',   'Tamil Nadu', '620'),
  ('621001', 10.9601, 78.0766, 'Perambalur',        'Tamil Nadu', '621'),
  ('622001', 10.3833, 78.8001, 'Pudukkottai',       'Tamil Nadu', '622'),
  ('623501', 9.3716,  78.8307, 'Ramanathapuram',    'Tamil Nadu', '623'),
  ('624001', 10.3673, 77.9803, 'Dindigul',          'Tamil Nadu', '624'),
  ('625001', 9.9252,  78.1198, 'Madurai',           'Tamil Nadu', '625'),
  ('625002', 9.9252,  78.1198, 'Madurai',           'Tamil Nadu', '625'),
  ('625020', 9.9252,  78.1198, 'Madurai',           'Tamil Nadu', '625'),
  -- Southern Tamil Nadu (626–630)
  ('626001', 9.4533,  77.8081, 'Virudhunagar',      'Tamil Nadu', '626'),
  ('627001', 8.7139,  77.7567, 'Tirunelveli',       'Tamil Nadu', '627'),
  ('628001', 8.7642,  78.1348, 'Thoothukudi',       'Tamil Nadu', '628'),
  ('629001', 8.1786,  77.4339, 'Kanyakumari',       'Tamil Nadu', '629'),
  ('630001', 9.8470,  78.4837, 'Sivaganga',         'Tamil Nadu', '630'),
  -- Vellore / Krishnagiri zone (631–635)
  ('631001', 12.8342, 79.7036, 'Kanchipuram',       'Tamil Nadu', '631'),
  ('632001', 12.9165, 79.1325, 'Vellore',           'Tamil Nadu', '632'),
  ('632501', 12.9165, 79.1325, 'Vellore',           'Tamil Nadu', '632'),
  ('632601', 13.0500, 79.3833, 'Arcot',             'Tamil Nadu', '632'),
  ('633001', 12.5800, 78.6200, 'Vaniyambadi',       'Tamil Nadu', '633'),
  ('635001', 12.5260, 78.2150, 'Krishnagiri',       'Tamil Nadu', '635'),
  ('635109', 12.7409, 77.8253, 'Hosur',             'Tamil Nadu', '635'),
  -- Salem / Erode / Namakkal (636–639)
  ('636001', 11.6643, 78.1460, 'Salem',             'Tamil Nadu', '636'),
  ('636004', 11.6643, 78.1460, 'Salem',             'Tamil Nadu', '636'),
  ('637001', 11.2189, 78.1675, 'Namakkal',          'Tamil Nadu', '637'),
  ('638001', 11.3410, 77.7172, 'Erode',             'Tamil Nadu', '638'),
  ('639001', 10.9601, 78.0766, 'Karur',             'Tamil Nadu', '639'),
  -- Coimbatore zone + Nilgiris (641–643)
  ('641001', 11.0168, 76.9558, 'Coimbatore',        'Tamil Nadu', '641'),
  ('641004', 11.0168, 76.9558, 'Coimbatore',        'Tamil Nadu', '641'),
  ('641035', 11.0050, 76.9658, 'Coimbatore',        'Tamil Nadu', '641'),
  ('642001', 10.6586, 77.0093, 'Pollachi',          'Tamil Nadu', '642'),
  ('642126', 10.4870, 76.7950, 'Valparai',          'Tamil Nadu', '642'),
  ('643001', 11.4102, 76.6950, 'Nilgiris',          'Tamil Nadu', '643'),
  ('643101', 11.4102, 76.6950, 'Ooty',              'Tamil Nadu', '643'),
  ('643211', 11.4965, 76.6932, 'Coonoor',           'Tamil Nadu', '643')
ON CONFLICT (pincode) DO NOTHING;
