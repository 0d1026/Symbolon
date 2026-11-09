import type { ReactNode, MouseEvent } from "react";
import { useTransition } from "./Transition";

export function TLink({ to, children, className = "", onClick }: { to: string; children: ReactNode; className?: string; onClick?: () => void }) {
  const { go } = useTransition();
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    onClick?.();
    go(to);
  };
  return <a href={to} className={className} onClick={handle}>{children}</a>;
}
