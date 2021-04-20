pragma solidity ^0.5.16;

interface IStakeStateUSDC {
    function stake(address _user, uint _amount) external;

    function unstake(address _user, uint _amount) external;

    function getStakeState(address _user) external view returns (uint, uint);

    function getTotalStake() external view returns (uint);
}
