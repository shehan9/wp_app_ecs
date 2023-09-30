import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
//import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Duration } from 'aws-cdk-lib';

export class WpCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    //VPC 
    const vpc = new ec2.Vpc(this, "wp-app-vpc", {
      cidr: "10.1.0.0/16",

      subnetConfiguration: [
        {  cidrMask: 24, subnetType: ec2.SubnetType.PUBLIC, name: "Public" },
        ],
      maxAzs: 3 // Default is all AZs in region
      
    });

    //ECS cluster
    const cluster = new ecs.Cluster(this, "wp-app-ecs", {
      vpc,
    });

    const autoScalingGroup = new autoscaling.AutoScalingGroup(this, 'ASG', {
      vpc,
      instanceType: new ec2.InstanceType('t2.micro'),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
      minCapacity: 0,
      desiredCapacity: 1,
      maxCapacity: 1,
    });

    const capacityProvider = new ecs.AsgCapacityProvider(this, 'AsgCapacityProvider', {
      autoScalingGroup,
    });
    cluster.addAsgCapacityProvider(capacityProvider);

    const taskDefinition = new ecs.Ec2TaskDefinition(this, 'wp-app-task-def',{
      networkMode: ecs.NetworkMode.AWS_VPC,
    });

    const container = taskDefinition.addContainer('wp-container', {
      image: ecs.ContainerImage.fromRegistry('wordpress:latest'),
      memoryLimitMiB: 256,
    });

    container.addPortMappings({
      containerPort: 80
    });
  
    //ECS service
    const sg_service = new ec2.SecurityGroup(this, 'wp-app-ecs-sg', { vpc: vpc });
    sg_service.addIngressRule(ec2.Peer.ipv4('0.0.0.0/0'), ec2.Port.tcp(80));

    const service = new ecs.Ec2Service(this, 'wp-app-ecs-svc', { 
      cluster: cluster, 
      taskDefinition: taskDefinition,
      desiredCount: 1,
      securityGroups: [sg_service],
     });

    // AutoScaling policy
/*    const scaling = service.autoScaleTaskCount({ maxCapacity: 2, minCapacity: 1 });
    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 50,
      scaleInCooldown: Duration.seconds(60),
      scaleOutCooldown: Duration.seconds(60)
    }); */

/*    cluster.addCapacity('DefaultAutoScalingGroup', {
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.MICRO)
    }); //This is not needed*/

    // ALB configs
    const lb = new elbv2.ApplicationLoadBalancer(this, 'wp-app-alb', {
      vpc: vpc,
      internetFacing: true
    });

    const listener = lb.addListener('Listener', {
      port: 80,
    });

    listener.addTargets('Target', {
      port: 80,
      targets: [service],
      healthCheck: { path: '/' }
    });

    listener.connections.allowDefaultPortFromAnyIpv4('Open to the world');

  }
}