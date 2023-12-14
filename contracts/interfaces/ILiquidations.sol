pragma solidity 0.5.16;

// https://docs.peri.finance/contracts/source/interfaces/iliquidations
interface ILiquidations {
    // Views
    function isOpenForLiquidation(address account) external view returns (bool);

    function getLiquidationDeadlineForAccount(address account) external view returns (uint);

    function isLiquidationDeadlinePassed(address account) external view returns (bool);

    function liquidationDelay() external view returns (uint);

    function liquidationRatio() external view returns (uint);

    function liquidationPenalty() external view returns (uint);

    function calculateAmountToFixCollateral(uint debtBalance, uint collateral) external view returns (uint);

    // Mutative Functions
    function flagAccountForLiquidation(address account) external;

    // Restricted: used internally to Issuer
    function removeAccountInLiquidation(address account) external;

    function liquidateAccount(address account, uint pusdAmount, uint debtBalance) 
        external returns (uint totalRedeemedinUSD, uint amountToLiquidate);

    function checkAndRemoveAccountInLiquidation(address account) external;
}
