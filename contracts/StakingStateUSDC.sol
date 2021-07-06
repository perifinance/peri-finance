pragma solidity 0.5.16;

import "./SafeDecimalMath.sol";
import "./State.sol";
import "./Owned.sol";
import "./interfaces/IERC20.sol";

contract StakingStateUSDC is Owned, State {
    using SafeMath for uint;
    using SafeDecimalMath for uint;

    address public USDC_ADDRESS;

    mapping(address => uint) public stakedAmountOf;

    uint public totalStakerCount;

    uint public totalStakedAmount;

    mapping(address => bool) public registered;

    address[] public stakers; // for migration later

    constructor(
        address _owner,
        address _associatedContract,
        address _usdcAddress
    ) public Owned(_owner) State(_associatedContract) {
        USDC_ADDRESS = _usdcAddress;
    }

    /* ========== VIEWER FUNCTIONS ========== */

    function userStakingShare(address _account) public view returns (uint) {
        uint _percentage =
            stakedAmountOf[_account] == 0 || totalStakedAmount == 0
                ? 0
                : (stakedAmountOf[_account]).divideDecimalRound(totalStakedAmount);

        return _percentage;
    }

    function decimals() external pure returns (uint8) {
        return 6;
    }

    function hasStaked(address _account) external view returns (bool) {
        return stakedAmountOf[_account] > 0;
    }

    function usdc() internal view returns (IERC20) {
        require(USDC_ADDRESS != address(0), "USDC address is empty");

        return IERC20(USDC_ADDRESS);
    }

    function usdcAddress() internal view returns (address) {
        return USDC_ADDRESS;
    }

    function stakersLength() external view returns (uint) {
        return stakers.length;
    }

    function getStakersByRange(uint _index, uint _cnt) external view returns (address[] memory) {
        require(_index >= 0, "index should not be less than zero");
        require(stakers.length >= _index + _cnt, "requesting size is too big to query");

        address[] memory _addresses = new address[](_cnt);
        for (uint i = 0; i < _cnt; i++) {
            _addresses[i] = stakers[i + _index];
        }

        return _addresses;
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

    function stake(address _account, uint _amount) external onlyAssociatedContract {
        if (stakedAmountOf[_account] == 0 && _amount > 0) {
            _incrementTotalStaker();

            if (!registered[_account]) {
                registered[_account] = true;
                stakers.push(_account);
            }
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
        return usdc().transfer(_account, _amount.div(10**12));
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
