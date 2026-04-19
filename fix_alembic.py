import pymysql
conn = pymysql.connect(host='roundhouse.proxy.rlwy.net', port=33209, user='root', password='ZeYjAGGWQtkOkAYMmEafdDzVMsaUASxN', db='railway')
cur = conn.cursor()

# Check if user_id column already exists
cur.execute("SHOW COLUMNS FROM analysis_sessions LIKE 'user_id'")
col = cur.fetchone()
if col:
    print('user_id column already exists:', col)
else:
    print('Adding user_id column...')
    cur.execute("""
        ALTER TABLE analysis_sessions
        ADD COLUMN user_id INT NULL,
        ADD CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        ADD INDEX ix_session_user (user_id)
    """)
    conn.commit()
    print('Done!')

# Create or update alembic_version
cur.execute("SHOW TABLES LIKE 'alembic_version'")
if not cur.fetchone():
    cur.execute("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL PRIMARY KEY)")
    cur.execute("INSERT INTO alembic_version VALUES ('0003_add_user_id_to_sessions')")
else:
    cur.execute("UPDATE alembic_version SET version_num = '0003_add_user_id_to_sessions'")
conn.commit()
print('Alembic version set to 0003_add_user_id_to_sessions')
conn.close()
