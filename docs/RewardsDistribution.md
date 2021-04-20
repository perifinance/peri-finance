## `RewardsDistribution`

### `constructor(address _owner, address _authority, address _periFinanceProxy, address _rewardEscrow, address _feePoolProxy)` (public)

\_authority maybe the underlying periFinance contract.
Remember to set the authority on a periFinance upgrade

### `setPeriFinanceProxy(address _periFinanceProxy)` (external)

### `setRewardEscrow(address _rewardEscrow)` (external)

### `setFeePoolProxy(address _feePoolProxy)` (external)

### `setAuthority(address _authority)` (external)

Set the address of the contract authorised to call distributeRewards()

### `addRewardDistribution(address destination, uint256 amount) → bool` (external)

Adds a Rewards DistributionData struct to the distributions
array. Any entries here will be iterated and rewards distributed to
each address when tokens are sent to this contract and distributeRewards()
is called by the autority.

### `removeRewardDistribution(uint256 index)` (external)

Deletes a RewardDistribution from the distributions
so it will no longer be included in the call to distributeRewards()

### `editRewardDistribution(uint256 index, address destination, uint256 amount) → bool` (external)

Edits a RewardDistribution in the distributions array.

### `distributeRewards(uint256 amount) → bool` (external)

### `distributionsLength() → uint256` (external)

Retrieve the length of the distributions array

### `RewardDistributionAdded(uint256 index, address destination, uint256 amount)`

### `RewardsDistributed(uint256 amount)`
