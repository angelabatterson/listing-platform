"use client";

import { startTransition, useActionState, type FormEvent } from "react";

// Like useActionState, but submits through onSubmit so React doesn't clear the
// form after the action runs. Users keep what they typed when there's an error.
export function useFormAction<S>(action: (state: S | undefined, formData: FormData) => Promise<S | undefined>) {
  const [state, dispatch, pending] = useActionState(action, undefined);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(() => dispatch(formData));
  };
  return { state, onSubmit, pending };
}
