pragma solidity ^0.5.16;

import "./SafeDecimalMath.sol";
import "./State.sol";
import "./Owned.sol";

contract StakeStateUSDC is Owned, State {
    using SafeMath for uint;
    using SafeDecimalMath for uint;

    struct Stake {
        uint amount;
        uint lastStakedTime;
    }

    mapping(address => Stake) public stakes;

    uint private _totalStakeAmount;

    constructor(address _owner, address _associatedContract) public Owned(_owner) State(_associatedContract) {}

    function stake(address _user, uint _amount) external onlyAssociatedContract {
        require(_user != address(0), "Zero address is not allowed");

        stakes[_user].amount = stakes[_user].amount.add(_amount);
        stakes[_user].lastStakedTime = block.timestamp;

        _totalStakeAmount = _totalStakeAmount.add(_amount);
    }

    function unstake(address _user, uint _amount) external onlyAssociatedContract {
        require(_user != address(0), "Zero address is not allowed");
        require(stakes[_user].amount >= _amount, "Exceeds staked amount");

        stakes[_user].amount = stakes[_user].amount.sub(_amount);

        require(_totalStakeAmount >= _amount, "Not enough total stake amount");

        _totalStakeAmount = _totalStakeAmount.sub(_amount);
    }

    function getStakeState(address _user) external view returns (uint _amount, uint _lastStakedTime) {
        _amount = stakes[_user].amount;
        _lastStakedTime = stakes[_user].lastStakedTime;
    }

    function getTotalStake() external view returns (uint) {
        return _totalStakeAmount;
    }

    function getUserDebtShare(address _user) external view returns (uint _debtPercentage) {
        if (stakes[_user].amount == 0) {
            return 0;
        }

        // calculation by precise decimal unit (10^27) (user / total)
        return stakes[_user].amount.divideDecimalRoundPrecise(_totalStakeAmount);
    }
}
