pragma solidity 0.5.16;

interface IStakingState {
    // Mutative
    function stake(address _account, uint _amount) external;

    function unstake(address _account, uint _amount) external;

    function refund(address _account, uint _amount) external returns (bool);

    // Admin
    function setTokenAddress(address _usdcAddress) external;

    function tokenAddress() external view returns (address);

    // View
    function stakedAmountOf(address _account) external view returns (uint);

    function totalStakerCount() external view returns (uint);

    function totalStakedAmount() external view returns (uint);

    function userStakingShare(address _account) external view returns (uint);

    function decimals() external view returns (uint8);

    function hasStaked(address _account) external view returns (bool);
}
