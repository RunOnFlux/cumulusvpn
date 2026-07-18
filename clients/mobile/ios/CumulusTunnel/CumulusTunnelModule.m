// CumulusTunnelModule.m
//
// Objective-C bridge that exposes the Swift `CumulusTunnel` module + its
// promise methods to the React Native runtime. Signatures mirror
// `src/native/CumulusTunnel.ts`.

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(CumulusTunnel, RCTEventEmitter)

RCT_EXTERN_METHOD(startTunnel:(NSString *)wgConfig
                  serverName:(NSString *)serverName
                  killSwitch:(BOOL)killSwitch
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(startMultihop:(NSString *)outerConfig
                  innerConfig:(NSString *)innerConfig
                  routeLabel:(NSString *)routeLabel
                  killSwitch:(BOOL)killSwitch
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(stopTunnel:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(openVpnSettings:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getStatus:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(isPrepared:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(requestPermission:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(solvePow:(NSString *)publicKeyB64
                  bits:(nonnull NSNumber *)bits
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
