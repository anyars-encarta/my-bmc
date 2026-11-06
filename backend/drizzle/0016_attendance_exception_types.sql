ALTER TABLE attendance_exception
  DROP CONSTRAINT attendance_exception_exception_type_check,
  ALTER COLUMN exception_type TYPE varchar(40),
  ADD CONSTRAINT attendance_exception_exception_type_check
  CHECK (exception_type IN (
    'LATE',
    'EARLY_LEAVE',
    'MISSING_CLOCK_OUT',
    'ABSENT',
    'UNROSTERED_PUNCH',
    'DEVICE_CLOCK_SKEW',
    'UNKNOWN_CREDENTIAL',
    'INACTIVE_STAFF',
    'BIOMETRIC_CONSENT_REQUIRED',
    'REJECTED_FUTURE_TIME',
    'PUNCH_RECONCILIATION_REQUIRED'
  ));
