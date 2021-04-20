## `DappMaintenance`

When the PeriFinance system is on maintenance (upgrade, release...etc) the dApps also need
to be put on maintenance so no transactions can be done. The DappMaintenance contract is here to keep a state of
the dApps which indicates if yes or no, they should be up or down.

### `constructor(address _owner)` (public)

Constructor

### `setMaintenanceModeAll(bool isPaused)` (external)

### `setMaintenanceModeStaking(bool isPaused)` (external)

### `setMaintenanceModeSX(bool isPaused)` (external)

### `StakingMaintenance(bool isPaused)`

### `SXMaintenance(bool isPaused)`
