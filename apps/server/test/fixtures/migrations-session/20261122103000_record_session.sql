-- Records the settings of the session that applies it.
CREATE TABLE session_settings AS
SELECT
  current_setting('statement_timeout') AS statement_timeout,
  current_setting('lock_timeout') AS lock_timeout,
  current_setting('application_name') AS application_name;
