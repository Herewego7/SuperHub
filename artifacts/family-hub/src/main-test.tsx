import { createRoot } from "react-dom/client";

function TestApp() {
  return <h1>React is working!</h1>;
}

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(<TestApp />);
} else {
  console.error("Root element not found!");
}