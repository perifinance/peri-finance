pragma solidity 0.5.16;

interface IPeriFinanceEscrow {
    function numVestingEntries(address account) external view returns (uint);

    function getVestingScheduleEntry(address account, uint index) external view returns (uint[2] memory);
}

// https://docs.peri.finance/contracts/source/contracts/escrowchecker
contract EscrowChecker {
    IPeriFinanceEscrow public periFinance_escrow;

    constructor(IPeriFinanceEscrow _esc) public {
        periFinance_escrow = _esc;
    }

    function checkAccountSchedule(address account) public view returns (uint[16] memory) {
        uint[16] memory _result;
        uint schedules = periFinance_escrow.numVestingEntries(account);
        for (uint i = 0; i < schedules; i++) {
            uint[2] memory pair = periFinance_escrow.getVestingScheduleEntry(account, i);
            _result[i * 2] = pair[0];
            _result[i * 2 + 1] = pair[1];
        }
        return _result;
    }
}
