pragma solidity ^0.5.16;

import "./SafeDecimalMath.sol";
import "./State.sol";
import "./Owned.sol";

import "./interfaces/IStakeState.sol";

contract StakeState is Owned, State, IStakeState {

  using SafeMath for uint;
  using SafeDecimalMath for uint;

  // A struct for handing values associated with an individual user's debt position
  struct StakingData {
    // Percentage of the total debt owned at the time
    // of issuance. This number is modified by the overall debt
    // delta array. You can figure out a user's exit price and
    // collateralisation ratio using a combination of their initial
    // debt and the slice of overall debt delta which applies to them.
    uint initialDebtOwnership;
    // This lets us know when (in relative terms) the user entered
    // the debt pool so we can calculate their exit price and
    // collateralisation ratio
    uint debtEntryIndex;
  }

  mapping(address => uint) public stakedAmountOf;

  mapping(address => uint) public issuedAmountOf;

  mapping(address => StakingData) public stakingData;

  // The total count of people that have outstanding issued synths in any flavour
  uint public totalStakerCount;

  // The total staked asset amount
  uint public totalStakedAmount;

  // The debt cache issued by this asset
  uint public totalDebtIssued;

  // Entity's debt pool tracking
  uint[] public debtLedger;

  constructor(address _owner, address _associatedContract)
  Owned(_owner)
  State(_associatedContract) 
  public {
  }

  function setCurrentStakingData(address _account, uint _initialDebtOwnership) 
  external
  onlyAssociatedContract {
    stakingData[_account].initialDebtOwnership = _initialDebtOwnership;
    stakingData[_account].debtEntryIndex = debtLedger.length;
  }

  function clearStakingData(address _account)
  external
  onlyAssociatedContract {
    delete stakingData[_account];
  }
  
  function addStakeAmount(address _account, uint _amount)
  external
  onlyAssociatedContract {
    stakedAmountOf[_account] = stakedAmountOf[_account].add(_amount);
    totalStakedAmount = totalStakedAmount.add(_amount);
  }

  function removeStakeAmount(address _account, uint _amount)
  external
  onlyAssociatedContract {
    require(stakedAmountOf[_account] >= _amount || totalStakedAmount >= _amount,
      "Not enough to decrease stake amount");

    stakedAmountOf[_account] = stakedAmountOf[_account].sub(_amount);
    totalStakedAmount = totalStakedAmount.sub(_amount);
  }

  function addIssuedAmount(address _account, uint _amount)
  external
  onlyAssociatedContract {
    issuedAmountOf[_account] = issuedAmountOf[_account].add(_amount);
    _issueDebts(_amount);
  }

  function removeIssuedAmount(address _account, uint _amount)
  external
  onlyAssociatedContract {
    require(issuedAmountOf[_account] >= _amount,
      "Not enough to decrease issued amount");
    
    issuedAmountOf[_account] = issuedAmountOf[_account].sub(_amount);
    _withdrawDebts(_amount);
  }

  function _issueDebts(uint _amount)
  internal
  onlyAssociatedContract {
    totalDebtIssued = totalDebtIssued.add(_amount);
  }

  function _withdrawDebts(uint _amount)
  internal
  onlyAssociatedContract {
    require(totalDebtIssued >= _amount,
      "Not enough issued debts to withdraw");

    totalDebtIssued = totalDebtIssued.sub(_amount);
  }

  function incrementTotalStakerCount()
  external
  onlyAssociatedContract {
    totalStakerCount = totalStakerCount.add(1);
  }

  function decrementTotalStakerCount()
  external
  onlyAssociatedContract {
    totalStakerCount = totalStakerCount.sub(1);
  }

  function appendDebtLedgerValue(uint value) 
  external 
  onlyAssociatedContract {
    debtLedger.push(value);
  }

  function debtLedgerLength()
  external view
  returns(uint) {
    return debtLedger.length;
  }

  function lastDebtLedgerEntry()
  external view
  returns(uint) {
    return debtLedger[debtLedger.length <= 0 ? 0 : debtLedger.length];
  }

  function getDebtLedger(uint _index)
  external view
  returns(uint) {
    return debtLedger[_index];
  }

  function hasStaked(address _account)
  external view
  returns(bool) {
    return stakingData[_account].initialDebtOwnership > 0; 
  }

}