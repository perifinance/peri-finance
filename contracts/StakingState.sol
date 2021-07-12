pragma solidity 0.5.16;

import "./SafeDecimalMath.sol";
import "./State.sol";
import "./Owned.sol";
import "./interfaces/IERC20.sol";

contract StakingState is Owned, State {
    using SafeMath for uint;
    using SafeDecimalMath for uint;

    struct TargetToken {
        address tokenAddress;
        uint8 decimals;
        bool activated;
    }

    mapping(bytes32 => TargetToken) public targetTokens;

    mapping(bytes32 => mapping(address => uint)) public stakedAmountOf;

    mapping(bytes32 => uint) public totalStakedAmount;

    mapping(bytes32 => uint) public totalStakerCount;

    bytes32[] public tokenList;

    constructor(address _owner, address _associatedContract) public Owned(_owner) State(_associatedContract) {}

    /* ========== VIEWER FUNCTIONS ========== */

    function tokenInstance(bytes32 _currencyKey) internal view returns (IERC20) {
        require(targetTokens[_currencyKey].tokenAddress != address(0), "Target address is empty");

        return IERC20(targetTokens[_currencyKey].tokenAddress);
    }

    function tokenAddress(bytes32 _currencyKey) external view returns (address) {
        return targetTokens[_currencyKey].tokenAddress;
    }

    function tokenDecimals(bytes32 _currencyKey) external view returns (uint8) {
        return targetTokens[_currencyKey].decimals;
    }

    function tokenActivated(bytes32 _currencyKey) external view returns (bool) {
        return targetTokens[_currencyKey].activated;
    }

    function getTokenCurrencyKeys() external view returns (bytes32[] memory) {
        return tokenList;
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

    function setTargetToken(
        bytes32 _currencyKey,
        address _tokenAddress,
        uint8 _decimals
    ) external onlyOwner {
        require(_tokenAddress != address(0), "Address cannot be empty");
        require(targetTokens[_currencyKey].tokenAddress == address(0), "Token is already registered");

        if (targetTokens[_currencyKey].tokenAddress == address(0)) {
            tokenList.push(_currencyKey);
        }

        targetTokens[_currencyKey] = TargetToken(_tokenAddress, _decimals, true);
    }

    function setTokenActivation(bytes32 _currencyKey, bool _activate) external onlyOwner {
        _requireTokenRegistered(_currencyKey);

        targetTokens[_currencyKey].activated = _activate;
    }

    function stake(
        bytes32 _currencyKey,
        address _account,
        uint _amount
    ) external onlyAssociatedContract {
        _requireTokenRegistered(_currencyKey);
        require(targetTokens[_currencyKey].activated, "Target token is not activated");

        if (stakedAmountOf[_currencyKey][_account] <= 0 && _amount > 0) {
            _incrementTotalStaker(_currencyKey);
        }

        stakedAmountOf[_currencyKey][_account] = stakedAmountOf[_currencyKey][_account].add(_amount);
        totalStakedAmount[_currencyKey] = totalStakedAmount[_currencyKey].add(_amount);

        emit Staking(_currencyKey, _account, _amount);
    }

    function unstake(
        bytes32 _currencyKey,
        address _account,
        uint _amount
    ) external onlyAssociatedContract {
        require(stakedAmountOf[_currencyKey][_account] >= _amount, "Account doesn't have enough staked amount");
        require(totalStakedAmount[_currencyKey] >= _amount, "Not enough staked amount to withdraw");

        if (stakedAmountOf[_currencyKey][_account].sub(_amount) == 0) {
            _decrementTotalStaker(_currencyKey);
        }

        stakedAmountOf[_currencyKey][_account] = stakedAmountOf[_currencyKey][_account].sub(_amount);
        totalStakedAmount[_currencyKey] = totalStakedAmount[_currencyKey].sub(_amount);

        emit Unstaking(_currencyKey, _account, _amount);
    }

    function refund(
        bytes32 _currencyKey,
        address _account,
        uint _amount
    ) external onlyAssociatedContract returns (bool) {
        uint decimalDiff = targetTokens[_currencyKey].decimals < 18 ? 18 - targetTokens[_currencyKey].decimals : 0;

        return tokenInstance(_currencyKey).transfer(_account, _amount.div(10**decimalDiff));
    }

    /* ========== INTERNAL FUNCTIONS ========== */

    function _requireTokenRegistered(bytes32 _currencyKey) internal view {
        require(targetTokens[_currencyKey].tokenAddress != address(0), "Target token is not registered");
    }

    function _incrementTotalStaker(bytes32 _currencyKey) internal {
        totalStakerCount[_currencyKey] = totalStakerCount[_currencyKey].add(1);
    }

    function _decrementTotalStaker(bytes32 _currencyKey) internal {
        totalStakerCount[_currencyKey] = totalStakerCount[_currencyKey].sub(1);
    }

    /* ========== EVENTS ========== */

    event Staking(bytes32 currencyKey, address account, uint amount);
    event Unstaking(bytes32 currencyKey, address account, uint amount);
}
