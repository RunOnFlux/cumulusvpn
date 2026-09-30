// CumulusIdentityModule.m
//
// Objective-C bridge that exposes the Swift `CumulusIdentity` module + its
// promise methods to the React Native runtime. Signatures mirror
// `src/native/CumulusIdentity.ts`.

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(CumulusIdentity, NSObject)

RCT_EXTERN_METHOD(save:(NSString *)secret
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(load:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(remove:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
