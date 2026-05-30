-- Migration to add extra metadata fields to reddit_posts and reddit_comments

ALTER TABLE reddit_posts 
ADD COLUMN author_fullname VARCHAR(100),
ADD COLUMN ups INTEGER,
ADD COLUMN awards_count INTEGER,
ADD COLUMN subreddit_subscribers INTEGER,
ADD COLUMN removed_by_category VARCHAR(50);

ALTER TABLE reddit_comments
ADD COLUMN author_fullname VARCHAR(100),
ADD COLUMN awards_count INTEGER;
