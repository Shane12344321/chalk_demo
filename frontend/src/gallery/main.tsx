import { createRoot } from "react-dom/client";
import { Gallery } from "./Gallery";
import "../styles.css";
import "./gallery.css";

// Dev-only board gallery; served by the Vite dev server at /gallery.html.
createRoot(document.getElementById("root")!).render(<Gallery />);
