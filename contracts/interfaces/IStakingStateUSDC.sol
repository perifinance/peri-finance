pragma solidity ^0.5.16;

interface IStakingStateUSDC {
  
  function issuanceData(address _account)
  external view
  returns(uint initialDebtOwnership, uint debtEntryIndex);
  
  function stakedAmountOf(address _account)
  external view
  returns(uint);

    function totalStakerCount() external view returns (uint);

  function totalStakedAmount()
  external view
  returns(uint);

  function debtLedger(uint _index)
  external view
  returns(uint);

    function stake(address _account, uint _amount) external;

    function unstake(address _account, uint _amount) external;

    function userStakingShare(address _account) external view returns (uint);

  function decimals()
  external view
  returns(uint8);

  function debtLedgerLength()
  external view
  returns(uint);
  
}
