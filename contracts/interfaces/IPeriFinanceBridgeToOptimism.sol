pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

interface IPeriFinanceBridgeToOptimism {
    function closeFeePeriod(uint periBackedDebt, uint debtSharesSupply) external;

    // Invoked by the relayer on L1
    function completeWithdrawal(address account, uint amount) external;

    // The following functions can be invoked by users on L1
    function initiateDeposit(uint amount) external;

    function initiateEscrowMigration(uint256[][] calldata entryIDs) external;

    function initiateRewardDeposit(uint amount) external;

    function depositAndMigrateEscrow(uint256 depositAmount, uint256[][] calldata entryIDs) external;
}


  
//     function migrateEscrow(uint256[][] calldata entryIDs) external;

//     function depositTo(address to, uint amount) external;

//     function depositReward(uint amount) external;

//     function depositAndMigrateEscrow(uint256 depositAmount, uint256[][] calldata entryIDs) external;
// }
