## `StakingRewards`

### `updateReward(address account)`

### `constructor(address _owner, address _rewardsDistribution, address _rewardsToken, address _stakingToken)` (public)

### `totalSupply() → uint256` (external)

### `balanceOf(address account) → uint256` (external)

### `lastTimeRewardApplicable() → uint256` (public)

### `rewardPerToken() → uint256` (public)

### `earned(address account) → uint256` (public)

### `getRewardForDuration() → uint256` (external)

### `stake(uint256 amount)` (external)

### `withdraw(uint256 amount)` (public)

### `getReward()` (public)

### `exit()` (external)

### `notifyRewardAmount(uint256 reward)` (external)

### `updatePeriodFinish(uint256 timestamp)` (external)

### `recoverERC20(address tokenAddress, uint256 tokenAmount)` (external)

### `setRewardsDuration(uint256 _rewardsDuration)` (external)

### `RewardAdded(uint256 reward)`

### `Staked(address user, uint256 amount)`

### `Withdrawn(address user, uint256 amount)`

### `RewardPaid(address user, uint256 reward)`

### `RewardsDurationUpdated(uint256 newDuration)`

### `Recovered(address token, uint256 amount)`
