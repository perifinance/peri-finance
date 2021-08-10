pragma solidity 0.5.16;

interface IBridgeState {
    // ----VIEWS

    function networkOpened(uint chainId) external view returns (bool);

    function accountOutboundings(
        address account,
        uint periodId,
        uint index
    ) external view returns (uint);

    function accountInboundings(address account, uint index) external view returns (uint);

    function inboundings(uint index)
        external
        view
        returns (
            address,
            uint,
            uint,
            uint,
            bool
        );

    function outboundings(uint index)
        external
        view
        returns (
            address,
            uint,
            uint,
            uint
        );

    function outboundPeriods(uint index)
        external
        view
        returns (
            uint,
            uint,
            uint[] memory,
            bool
        );

    function outboundIdsToProcess(uint index) external view returns (uint);

    function numberOfOutboundPerPeriod() external view returns (uint);

    function periodDuration() external view returns (uint);

    function outboundingsLength() external view returns (uint);

    function inboundingsLength() external view returns (uint);

    function outboundIdsInPeriod(uint outboundPeriodId) external view returns (uint[] memory);

    function isOnRole(bytes32 roleKey, address account) external view returns (bool);

    function accountOutboundingsInPeriod(address _account, uint _period) external view returns (uint[] memory);

    function applicableInboundIds(address account) external view returns (uint[] memory);

    function outboundRequestIdsInPeriod(address account, uint periodId) external view returns (uint[] memory);

    function periodIdsToProcess() external view returns (uint[] memory);

    // ----MUTATIVES

    function appendOutboundingRequest(
        address account,
        uint amount,
        uint destChainIds
    ) external;

    function appendMultipleInboundingRequests(
        address[] calldata accounts,
        uint[] calldata amounts,
        uint[] calldata srcChainIds,
        uint[] calldata srcOutboundingIds
    ) external;

    function appendInboundingRequest(
        address account,
        uint amount,
        uint srcChainId,
        uint srcOutboundingId
    ) external;

    function claimInbound(uint index) external;
}
