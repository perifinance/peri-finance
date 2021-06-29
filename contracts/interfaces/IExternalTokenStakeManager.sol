pragma solidity ^0.5.16;

contract IExternalTokenStakeManager {
    function totalStakedAmountOf(address _user, bytes32 _unitCurrency) external view returns (uint);

    function stakedAmountOf(
        address _user,
        bytes32 _currencyKey,
        bytes32 _unitCurrency
    ) external view returns (uint);
}
