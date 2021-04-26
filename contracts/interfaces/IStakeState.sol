pragma solidity ^0.5.16;

contract IStakeState {
  
  function stakedAmountOf(address _account) 
  external view 
  returns(uint);

  function issuedAmountOf(address _account) 
  external view 
  returns(uint);

  function stakingData(address _account) 
  external view 
  returns(uint _initialDebtOwnership, uint _debtEntryIndex);
  
  function totalStakerCount() 
  external view 
  returns(uint);

  function totalStakedAmount()
  external view
  returns(uint);

  function totalDebtIssued()
  external view
  returns(uint);

  function setCurrentStakingData(address _account, uint _initialDebtOwnership)
  external;

  function clearStakingData(address _account)
  external;

  function addStakeAmount(address _account, uint _amount)
  external;

  function removeStakeAmount(address _account, uint _amount)
  external;

  function addIssuedAmount(address _account, uint _amount)
  external;

  function removeIssuedAmount(address _account, uint _amount)
  external;

  function incrementTotalStakerCount()
  external;

  function decrementTotalStakerCount()
  external;

  function appendDebtLedgerValue(uint value) 
  external;

  function debtLedgerLength()
  external view
  returns(uint);

  function lastDebtLedgerEntry()
  external view
  returns(uint);

  function getDebtLedger(uint _index)
  external view
  returns(uint);

  function hasStaked(address _account)
  external view
  returns(bool);

}