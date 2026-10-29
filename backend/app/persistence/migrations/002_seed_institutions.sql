INSERT INTO app.institutions (id, code, name, institution_type, color)
VALUES
    (gen_random_uuid(), 'APGB', 'Andhra Pradesh Grameena Bank', 'Bank', '#007a3d'),
    (gen_random_uuid(), 'BOB', 'Bank of Baroda', 'Bank', '#f58220'),
    (gen_random_uuid(), 'BOI', 'Bank of India', 'Bank', '#0072bc'),
    (gen_random_uuid(), 'BOM', 'Bank of Maharashtra', 'Bank', '#0b5ca8'),
    (gen_random_uuid(), 'CANARA', 'Canara Bank', 'Bank', '#007f5f'),
    (gen_random_uuid(), 'CBOI', 'Central Bank of India', 'Bank', '#005baa'),
    (gen_random_uuid(), 'CUB', 'City Union Bank', 'Bank', '#7b1b2b'),
    (gen_random_uuid(), 'KB', 'Karnataka Bank', 'Bank', '#7a263a'),
    (gen_random_uuid(), 'KVB', 'Karur Vysya Bank', 'Bank', '#7a1f5c'),
    (gen_random_uuid(), 'PNB', 'Punjab National Bank', 'Bank', '#a20f2d'),
    (gen_random_uuid(), 'UBI', 'Union Bank of India', 'Bank', '#d71920'),
    (gen_random_uuid(), 'PUB', 'Priyadarshini Urban Co-operative Bank Ltd., Adoni', 'Bank', '#6b4f2a'),
    (gen_random_uuid(), 'AMF', 'Adoni Mutual Funds', 'Bank', '#476b58'),
    (gen_random_uuid(), 'HDBFS', 'HDB Financial Services Limited', 'NBFC', '#ed1c24'),
    (gen_random_uuid(), 'TYGER', 'Tyger Capital', 'NBFC', '#e57a18'),
    (gen_random_uuid(), 'UGRO', 'UGRO Capital Limited', 'NBFC', '#652d90')
ON CONFLICT (code) DO NOTHING;
