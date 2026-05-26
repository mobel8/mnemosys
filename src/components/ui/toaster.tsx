/**
 * Renders the active toasts produced by `useToast()`. Mounted once near the
 * root of the app (alongside `<ToastViewport>`), so any component can
 * trigger a toast without prop drilling.
 */

import { Toast, ToastClose, ToastDescription, ToastTitle } from "@/components/ui/toast";
import { useToast } from "@/components/ui/use-toast";

export function Toaster() {
  const { toasts } = useToast();

  return (
    <>
      {toasts.map(({ id, title, description, action, ...props }) => (
        <Toast key={id} {...props}>
          <div className="grid gap-1">
            {title && <ToastTitle>{title}</ToastTitle>}
            {description && <ToastDescription>{description}</ToastDescription>}
          </div>
          {action}
          <ToastClose />
        </Toast>
      ))}
    </>
  );
}
