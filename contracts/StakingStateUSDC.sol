pragma solidity ^0.5.16;

import "./SafeDecimalMath.sol";
import "./State.sol";
import "./Owned.sol";
import "./interfaces/IERC20.sol";

contract StakingStateUSDC is Owned, State {

  using SafeMath for uint;
  using SafeDecimalMath for uint;

  address private USDC_ADDRESS;

  mapping(address => uint) public stakedAmountOf;

  uint public totalStakerCount;

  uint public totalStakedAmount;

  constructor(
    address _owner, 
    address _associatedContract,
    address _usdcAddress
  )
  Owned(_owner) 
  State(_associatedContract) 
  public {
    USDC_ADDRESS = _usdcAddress;
  }


  /* ========== VIEWER FUNCTIONS ========== */

  function userStakingShare(address _account)
  public view 
  returns(uint) {
    uint _percentage = stakedAmountOf[_account] == 0 || totalStakedAmount == 0 ? 
      0 : (stakedAmountOf[_account].mul(10**12)).multiplyDecimalRound(totalStakedAmount.mul(10**12));

    return _percentage;
  }

  function decimals()
  external pure
  returns(uint8) {
    return 6;
  }

  function hasStaked(address _account)
  external view
  returns(bool) {
    return stakedAmountOf[_account] > 0;
  }

  function usdc()
  internal view 
  returns(IERC20) {
    require(USDC_ADDRESS != address(0),
      "USDC address is empty");
    
    return IERC20(USDC_ADDRESS);
  }

  function usdcAddress()
  internal view
  returns(address) {
    return USDC_ADDRESS;
  }


  /* ========== MUTATIVE FUNCTIONS ========== */

  function setUSDCAddress(address _usdcAddress)
  external
  onlyOwner {
    require(_usdcAddress != address(0),
      "Address should not be empty");
    
    USDC_ADDRESS = _usdcAddress;
  }

  function stake(address _account, uint _amount)
  external
  onlyAssociatedContract {
    if(stakedAmountOf[_account] <= 0 && _amount > 0) {
      _incrementTotalStaker();
    }
    
    stakedAmountOf[_account] = stakedAmountOf[_account].add(_amount);
    totalStakedAmount = totalStakedAmount.add(_amount);

    emit Staking(_account, _amount, userStakingShare(_account));
  }

  function unstake(address _account, uint _amount)
  external
  onlyAssociatedContract {
    require(stakedAmountOf[_account] >= _amount,
      "User doesn't have enough staked amount");
    require(totalStakedAmount >= _amount,
      "Not enough staked amount to withdraw");

    if(stakedAmountOf[_account].sub(_amount) == 0) {
      _decrementTotalStaker();
    }

    stakedAmountOf[_account] = stakedAmountOf[_account].sub(_amount);
    totalStakedAmount = totalStakedAmount.sub(_amount);

    emit Unstaking(_account, _amount, userStakingShare(_account));
  }

  function refund(address _account, uint _amount)
  external
  onlyAssociatedContract 
  returns(bool) {
    return usdc().transfer(_account, _amount);
  }


  /* ========== INTERNAL FUNCTIONS ========== */

  function _incrementTotalStaker()
  internal {
    totalStakerCount = totalStakerCount.add(1);
  }

  function _decrementTotalStaker()
  internal {
    totalStakerCount = totalStakerCount.sub(1);
  }
  

  /* ========== EVENTS ========== */

  event Staking(address indexed account, uint amount, uint percentage);
  event Unstaking(address indexed account, uint amount, uint percentage);
  
}