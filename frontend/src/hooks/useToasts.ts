import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import type { Toast, ToastType } from "../hackbuddyTypes";

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const add = useCallback((msg: ReactNode, type: ToastType = "success") => {
    const id = Date.now();
    setToasts((current) => [...current, { id, msg, type }]);
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3000);
  }, []);

  return { toasts, add };
}
