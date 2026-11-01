"use client";

import { startTransition, useActionState, type FormEvent } from "react";

// Like useActionState, but submits through onSubmit so React doesn't clear the
// form after the action runs. Users keep what they typed when there's an error.
export function useFormAction<S>(action: (state: S | undefined, formData: FormData) => Promise<S | undefined>) {
  const [state, dispatch, pending] = useActionState(action, undefined);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Include the button that was clicked, so a form can have more than one (e.g. Save and Save + Sync).
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(e.currentTarget, submitter instanceof HTMLButtonElement && submitter.name ? submitter : null);
    startTransition(() => dispatch(formData));
  };
  return { state, onSubmit, pending };
}
