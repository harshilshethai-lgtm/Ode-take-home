import { useCallback, useEffect, useState } from "react";

const KEY = "halcyon.theme";

function current(): "light" | "dark" {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** Light/dark from tokens. The class on <html> flips every CSS variable in index.css. */
export function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(current);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      localStorage.setItem(KEY, next);
      return next;
    });
  }, []);

  return { theme, toggle };
}
