pragma solidity >=0.4.24;

// https://docs.periFinance.io/contracts/source/interfaces/ifeepool
interface IFeePool {
    // Views

    // solhint-disable-next-line func-name-mixedcase
    function FEE_ADDRESS() external view returns (address);

    function feesAvailable(address account) external view returns (uint, uint);

    function feesBurned(address account) external view returns (uint);

    function feesToBurn(address account) external view returns (uint);

    function feePeriodDuration() external view returns (uint);

    function isFeesClaimable(address account) external view returns (bool);

    function targetThreshold() external view returns (uint);

    function totalFeesAvailable() external view returns (uint);

    function totalFeesBurned() external view returns (uint);

    function totalRewardsAvailable() external view returns (uint);

    // Mutative Functions
    function claimFees() external returns (bool);

    function claimOnBehalf(address claimingForAddress) external returns (bool);

    function closeCurrentFeePeriod() external;

    function closeSecondary(uint periBackedDebt, uint debtShareSupply) external;

    function recordFeePaid(uint pUSDAmount) external;

    function setRewardsToDistribute(uint amount) external;

    function distributeFeeRewards(uint[] calldata feeRewards) external;

    function recentFeePeriods(uint index)
        external
        view
        returns (
            uint64,
            uint64,
            uint64,
            uint,
            uint,
            uint,
            uint
        );

    // Restricted: used internally to PeriFinance
    function appendAccountIssuanceRecord(
        address account,
        uint lockedAmount,
        uint debtEntryIndex
    ) external;
}
