pragma solidity 0.5.16;

import "./SafeDecimalMath.sol";
import "./State.sol";
import "./Owned.sol";
import "./interfaces/IERC20.sol";

contract StakingState is Owned, State {
    using SafeMath for uint;
    using SafeDecimalMath for uint;

    address private TARGET_TOKEN;

    mapping(address => uint) public stakedAmountOf;

    uint public totalStakerCount;

    uint public totalStakedAmount;

    uint8 public decimals;

    constructor(
        address _owner,
        address _associatedContract,
        address _tokenAddress,
        uint8 _decimals
    ) public Owned(_owner) State(_associatedContract) {
        TARGET_TOKEN = _tokenAddress;
        decimals = _decimals;
    }

    /* ========== VIEWER FUNCTIONS ========== */

    function userStakingShare(address _account) public view returns (uint) {
        uint _percentage =
            stakedAmountOf[_account] == 0 || totalStakedAmount == 0
                ? 0
                : (stakedAmountOf[_account]).multiplyDecimalRound(totalStakedAmount);

        return _percentage;
    }

    function hasStaked(address _account) external view returns (bool) {
        return stakedAmountOf[_account] > 0;
    }

    function tokenInstance() internal view returns (IERC20) {
        require(TARGET_TOKEN != address(0), "Target address is empty");

        return IERC20(TARGET_TOKEN);
    }

    function tokenAddress() external view returns (address) {
        return TARGET_TOKEN;
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

    function setTokenAddress(address _tokenAddress) external onlyOwner {
        require(_tokenAddress != address(0), "Address should not be empty");

        TARGET_TOKEN = _tokenAddress;
    }

    function stake(address _account, uint _amount) external onlyAssociatedContract {
        if (stakedAmountOf[_account] <= 0 && _amount > 0) {
            _incrementTotalStaker();
        }

        stakedAmountOf[_account] = stakedAmountOf[_account].add(_amount);
        totalStakedAmount = totalStakedAmount.add(_amount);

        emit Staking(_account, _amount, userStakingShare(_account));
    }

    function unstake(address _account, uint _amount) external onlyAssociatedContract {
        require(stakedAmountOf[_account] >= _amount, "User doesn't have enough staked amount");
        require(totalStakedAmount >= _amount, "Not enough staked amount to withdraw");

        if (stakedAmountOf[_account].sub(_amount) == 0) {
            _decrementTotalStaker();
        }

        stakedAmountOf[_account] = stakedAmountOf[_account].sub(_amount);
        totalStakedAmount = totalStakedAmount.sub(_amount);

        emit Unstaking(_account, _amount, userStakingShare(_account));
    }

    function refund(address _account, uint _amount) external onlyAssociatedContract returns (bool) {
        uint decimalDiff = decimals < 18 ? 18 - decimals : decimals - 18;

        return tokenInstance().transfer(_account, _amount.div(10**decimalDiff));
    }

    /* ========== INTERNAL FUNCTIONS ========== */

    function _incrementTotalStaker() internal {
        totalStakerCount = totalStakerCount.add(1);
    }

    function _decrementTotalStaker() internal {
        totalStakerCount = totalStakerCount.sub(1);
    }

    /* ========== EVENTS ========== */

    event Staking(address indexed account, uint amount, uint percentage);
    event Unstaking(address indexed account, uint amount, uint percentage);
}
