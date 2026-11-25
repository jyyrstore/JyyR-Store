-- Allow terminal supplier rejection before an order is created.

ALTER TABLE public.dwigital_orders
  DROP CONSTRAINT IF EXISTS dwigital_orders_submission_state_check;

ALTER TABLE public.dwigital_orders
  ADD CONSTRAINT dwigital_orders_submission_state_check
  CHECK (
    submission_state IN (
      'not_submitted',
      'submitting',
      'unknown',
      'submitted',
      'rejected'
    )
  );
