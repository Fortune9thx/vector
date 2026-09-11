"""
Deliberately vulnerable demo target for Vector's own live disclosure proof.

This file exists ONLY to give a Vector bounty program a real, inspectable
vulnerability to fetch and verify against -- it is never imported or
executed by the app itself, and ships no real database connection.
"""


def get_user(conn, username):
    query = "SELECT * FROM users WHERE username = '" + username + "'"
    return conn.execute(query).fetchone()


def get_comment(conn, comment_id):
    query = f"SELECT * FROM comments WHERE id = {comment_id}"
    return conn.execute(query).fetchone()
