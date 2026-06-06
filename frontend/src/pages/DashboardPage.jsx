import { memo } from "react";

import CommandCenterView from "../components/commandcenter/CommandCenterView";

function DashboardPage() {
  return <CommandCenterView />;
}

export default memo(DashboardPage);
