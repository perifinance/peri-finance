pragma solidity 0.5.16;

// https://docs.peri.finance/contracts/source/interfaces/ihasbalance
interface IHasBalance {
    // Views
    function balanceOf(address account) external view returns (uint);
}
