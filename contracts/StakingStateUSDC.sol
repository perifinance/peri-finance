pragma solidity ^0.5.16;

import "./SafeDecimalMath.sol";
import "./State.sol";
import "./Owned.sol";

contract StakingStateUSDC is Owned, State {
    using SafeMath for uint;
    using SafeDecimalMath for uint;

    struct IssuanceData {
        uint initialDebtOwnership;
        uint debtEntryIndex;
    }

    mapping(address => IssuanceData) public issuanceData;

    mapping(address => uint) public stakedAmountOf;

    uint public totalStakerCount;

    uint public totalStakedAmount;

    uint[] public debtLedger;

    event Staking(address indexed account, uint amount, uint debtPercentage);

    event Unstaking(address indexed account, uint amount, uint debtPercentage);

    constructor(address _owner, address _associatedContract) public Owned(_owner) State(_associatedContract) {}

    function stake(address _account, uint _amount) external onlyAssociatedContract {
        if (stakedAmountOf[_account] <= 0) {
            _incrementTotalStaker();
        }

        stakedAmountOf[_account] = stakedAmountOf[_account].add(_amount);
        totalStakedAmount = totalStakedAmount.add(_amount);

        uint debtPercentage = stakedAmountOf[_account].divideDecimalRoundPrecise(totalStakedAmount);
        uint delta = SafeDecimalMath.preciseUnit().sub(debtPercentage);

        _setCurrentIssuanceData(_account, debtPercentage);

        if (delta == 0 || debtLedger.length <= 0) {
            debtLedger.push(SafeDecimalMath.preciseUnit());
        } else if (debtLedger.length > 0) {
            debtLedger.push(debtLedger[debtLedger.length - 1].multiplyDecimalRoundPrecise(delta));
        } else {
            revert("Invalid debt percentage");
        }

        emit Staking(_account, _amount, debtPercentage);
    }

    function unstake(address _account, uint _amount) external onlyAssociatedContract {
        require(stakedAmountOf[_account] >= _amount, "User doesn't have enough staked amount");
        require(totalStakedAmount >= _amount, "Not enough staked amount to withdraw");

        if (stakedAmountOf[_account].sub(_amount) == 0) {
            _decrementTotalStaker();
        }

        stakedAmountOf[_account] = stakedAmountOf[_account].sub(_amount);
        totalStakedAmount = totalStakedAmount.sub(_amount);

        uint delta = 0;
        uint debtPercentage = 0;

        if (totalStakedAmount > 0) {
            debtPercentage = _amount.divideDecimalRoundPrecise(totalStakedAmount);

            delta = SafeDecimalMath.preciseUnit().add(debtPercentage);
        }

        if (stakedAmountOf[_account] == 0) {
            _setCurrentIssuanceData(_account, 0);
        } else {
            debtPercentage = stakedAmountOf[_account].divideDecimalRoundPrecise(totalStakedAmount);

            _setCurrentIssuanceData(_account, debtPercentage);
        }

        debtLedger.push(debtLedger[debtLedger.length - 1].multiplyDecimalRoundPrecise(delta));

        emit Unstaking(_account, _amount, debtPercentage);
    }

    function userStakingShare(address _account) external view onlyAssociatedContract returns (uint) {
        return stakedAmountOf[_account].divideDecimalRound(totalStakedAmount);
    }

    function decimals() external view returns (uint8) {
        return 6;
    }

    function debtLedgerLength() external view returns (uint) {
        return debtLedger.length;
    }

    function hasIssued(address _account) external view returns (bool) {
        return issuanceData[_account].initialDebtOwnership > 0;
    }

    function _incrementTotalStaker() internal {
        totalStakerCount = totalStakerCount.add(1);
    }

    function _decrementTotalStaker() internal {
        totalStakerCount = totalStakerCount.sub(1);
    }

    function _setCurrentIssuanceData(address _account, uint _debtPercentage) internal {
        issuanceData[_account].initialDebtOwnership = _debtPercentage;
        issuanceData[_account].debtEntryIndex = debtLedger.length;
    }
}
