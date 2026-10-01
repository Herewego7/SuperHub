import { useState } from "react";
import { Button } from "@/components/ui/button";
import { UpgradeDialogHost, showUpgradeDialog } from "@/lib/upgradeDialog";

export function setup(): void {}

export function Component() {
  const [managed, setManaged] = useState(false);
  return (
    <div>
      <Button data-testid="trigger-402" onClick={() => showUpgradeDialog()}>
        Simulate 402
      </Button>
      {managed && <div data-testid="managed-fired">Manage subscription callback fired</div>}
      <UpgradeDialogHost onManageSubscription={() => setManaged(true)} />
    </div>
  );
}
