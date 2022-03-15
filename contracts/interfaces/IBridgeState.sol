pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

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
            bool,
            bytes32,
            bytes32,
            uint8
        );

    function outboundings(uint index)
        external
        view
        returns (
            address,
            uint,
            uint,
            uint,
            bytes32,
            bytes32,
            uint8
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

    function srcOutboundingIdRegistered(uint chainId, uint srcOutboundingId) external view returns (bool isRegistered);

    function numberOfOutboundPerPeriod() external view returns (uint);

    function periodDuration() external view returns (uint);

    function outboundingsLength() external view returns (uint);

    function getTotalOutboundAmount() external view returns (uint);

    function inboundingsLength() external view returns (uint);

    function getTotalInboundAmount() external view returns (uint);

    function outboundIdsInPeriod(uint outboundPeriodId) external view returns (uint[] memory);

    function isOnRole(bytes32 roleKey, address account) external view returns (bool);

    function accountOutboundingsInPeriod(address _account, uint _period) external view returns (uint[] memory);

    function applicableInboundIds(address account) external view returns (uint[] memory);

    function outboundRequestIdsInPeriod(address account, uint periodId) external view returns (uint[] memory);

    function periodIdsToProcess() external view returns (uint[] memory);

    function getMovedAmount(uint _inboundOutbound, uint targetNetworkId) external view returns (uint);

    // ----MUTATIVES

    function appendOutboundingRequest(
        address account,
        uint amount,
        uint destChainIds,
        bytes32 r,
        bytes32 s,
        uint8 v
    ) external;

    function appendMultipleInboundingRequests(
        address[] calldata accounts,
        uint[] calldata amounts,
        uint[] calldata srcChainIds,
        uint[] calldata srcOutboundingIds,
        bytes32[] calldata r,
        bytes32[] calldata s,
        uint8[] calldata v
    ) external;

    function appendInboundingRequest(
        address account,
        uint amount,
        uint srcChainId,
        uint srcOutboundingId,
        bytes32 r,
        bytes32 s,
        uint8 v
    ) external;

    function claimInbound(uint index, uint _amount) external;
}
