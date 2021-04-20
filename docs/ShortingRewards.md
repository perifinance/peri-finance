## `ShortingRewards`

### `updateReward(address account)`

### `onlyShortContract()`

### `constructor(address _owner, address _resolver, address _rewardsDistribution, address _rewardsToken)` (public)

### `resolverAddressesRequired() → bytes32[] addresses` (public)

### `_short() → contract ICollateralErc20` (internal)

### `totalSupply() → uint256` (external)

### `balanceOf(address account) → uint256` (external)

### `lastTimeRewardApplicable() → uint256` (public)

### `rewardPerToken() → uint256` (public)

### `earned(address account) → uint256` (public)

### `getRewardForDuration() → uint256` (external)

### `enrol(address account, uint256 amount)` (external)

### `withdraw(address account, uint256 amount)` (external)

### `getReward(address account)` (external)

### `notifyRewardAmount(uint256 reward)` (external)

### `setRewardsDuration(uint256 _rewardsDuration)` (external)

### `RewardAdded(uint256 reward)`

### `Enrol(address user, uint256 amount)`

### `Withdrawn(address user, uint256 amount)`

### `RewardPaid(address user, uint256 reward)`

### `RewardsDurationUpdated(uint256 newDuration)`
