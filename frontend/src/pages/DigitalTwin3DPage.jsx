import { Navigate } from "react-router-dom";

/** Legacy 3D twin route — replaced by isometric command center on dashboard */
export default function DigitalTwin3DPage() {
  return <Navigate to="/dashboard" replace />;
}
