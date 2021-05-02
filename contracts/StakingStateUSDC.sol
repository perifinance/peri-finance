pragma solidity ^0.5.16;

import "./SafeDecimalMath.sol";
import "./State.sol";
import "./Owned.sol";

contract StakingStateUSDC is Owned, State {

  using SafeMath for uint;
  using SafeDecimalMath for uint;

  mapping(address => uint) public stakedAmountOf;

  uint public totalStakerCount;

  uint public totalStakedAmount;

  event Staking(address indexed account, uint amount);

  event Unstaking(address indexed account, uint amount);

  constructor(address _owner, address _associatedContract) 
  Owned(_owner) 
  State(_associatedContract) 
  public {
  }

  function stake(address _account, uint _amount)
  external
  onlyAssociatedContract {
    if(stakedAmountOf[_account] <= 0) {
      _incrementTotalStaker();
    }
    
    stakedAmountOf[_account] = stakedAmountOf[_account].add(_amount);
    totalStakedAmount = totalStakedAmount.add(_amount);

    emit Staking(_account, _amount);
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

    emit Unstaking(_account, _amount);
  }

  function userStakingShare(address _account)
  external view
  onlyAssociatedContract 
  returns(uint) {
    return stakedAmountOf[_account].divideDecimalRound(totalStakedAmount);
  }

  function decimals()
  external view
  returns(uint8) {
    return 6;
  }
  
  function _incrementTotalStaker()
  internal {
    totalStakerCount = totalStakerCount.add(1);
  }

  function _decrementTotalStaker()
  internal {
    totalStakerCount = totalStakerCount.sub(1);
  }

  
}