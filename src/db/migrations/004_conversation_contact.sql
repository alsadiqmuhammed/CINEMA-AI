-- Contact details typed into a chat. Only a WhatsApp sender's own number is proof of who is writing;
-- anything else is kept here, on the conversation, and never attaches the chat to an existing customer.
ALTER TABLE conversations
  ADD COLUMN contact_name       TEXT,
  ADD COLUMN contact_phone      TEXT,
  ADD COLUMN contact_email      TEXT,
  ADD COLUMN contact_interests  TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN contact_unverified BOOLEAN NOT NULL DEFAULT FALSE;
