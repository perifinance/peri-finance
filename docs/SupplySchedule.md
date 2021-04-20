## `SupplySchedule`

### `onlyPeriFinance()`

Only the PeriFinance contract is authorised to call this function

### `constructor(address _owner, uint256 _lastMintEvent, uint256 _currentWeek)` (public)

### `mintableSupply() → uint256` (external)

### `tokenDecaySupplyForWeek(uint256 counter) → uint256` (public)

New token supply reduces by the decay rate each week calculated as supply = INITIAL_WEEKLY_SUPPLY \* ()

### `terminalInflationSupply(uint256 totalSupply, uint256 numOfWeeks) → uint256` (public)

Weekly compound rate based on number of weeks

### `weeksSinceLastIssuance() → uint256` (public)

Take timeDiff in seconds (Dividend) and MINT_PERIOD_DURATION as (Divisor)

### `isMintable() → bool` (public)

### `recordMintEvent(uint256 supplyMinted) → bool` (external)

Record the mint event from PeriFinance by incrementing the inflation
week counter for the number of weeks minted (probabaly always 1)
and store the time of the event.

### `setMinterReward(uint256 amount)` (external)

Sets the reward amount of PERI for the caller of the public
function PeriFinance.mint().
This incentivises anyone to mint the inflationary supply and the mintr
Reward will be deducted from the inflationary supply and sent to the caller.

### `setPeriFinanceProxy(contract IPeriFinance _periFinanceProxy)` (external)

Set the PynthetixProxy should it ever change.
SupplySchedule requires PeriFinance address as it has the authority
to record mint event.

### `SupplyMinted(uint256 supplyMinted, uint256 numberOfWeeksIssued, uint256 lastMintEvent, uint256 timestamp)`

Emitted when the inflationary supply is minted

### `MinterRewardUpdated(uint256 newRewardAmount)`

Emitted when the PERI minter reward amount is updated

### `PeriFinanceProxyUpdated(address newAddress)`

Emitted when setPynthetixProxy is called changing the PeriFinance Proxy address
