-- Buyers are told when their order moves (confirmed, shipped, delivered, cancelled): a new notification type.
ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN ('sale', 'report', 'order'));
