import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
//import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Duration } from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';

export class WpCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Reading SSM Parameters for RDS credentials
    const rds_host = ssm.StringParameter.fromStringParameterAttributes(
      this,
      'rds_host',
      {parameterName: '/wp_app/rds_host'},
    );

    const rds_username = ssm.StringParameter.fromStringParameterAttributes(
      this,
      'rds_username',
      {parameterName: '/wp_app/rds_username'},
    );

    const rds_password = ssm.StringParameter.fromStringParameterAttributes(
      this,
      'rds_password',
      {parameterName: '/wp_app/rds_password'},
    );

    /*new cdk.CfnOutput(this, 'imported-param-3-value', {
      value: rds_host.stringValue
    });   cdk deploy --outputs-file ./temp-cdk-outputs.json */

    //console output for BITBUCKET_BUILD_NUMBER which uses as docker tag.
    console.log('BITBUCKET_BUILD_NUMBER', process.env.BITBUCKET_BUILD_NUMBER);

    //Creating VPC 
    const vpc = new ec2.Vpc(this, "wp-app-vpc", {
      cidr: "10.1.0.0/16",
      natGateways: 1,
      subnetConfiguration: [
        {  cidrMask: 24, subnetType: ec2.SubnetType.PUBLIC, name: "Public" },
        {  cidrMask: 24, subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS  , name: "Private" }
        ],
      maxAzs: 3 // Default is all AZs in region
      
    });

    //ECS cluster
    const cluster = new ecs.Cluster(this, "wp-app-ecs", {
      vpc,
    });

    const autoScalingGroup = new autoscaling.AutoScalingGroup(this, 'ASG', {
      vpc,
      instanceType: new ec2.InstanceType('t3.medium'),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
      minCapacity: 0,
      desiredCapacity: 1,
      maxCapacity: 2,
    });

    const capacityProvider = new ecs.AsgCapacityProvider(this, 'AsgCapacityProvider', {
      autoScalingGroup,
    });
    cluster.addAsgCapacityProvider(capacityProvider);

   const taskDefinition = new ecs.Ec2TaskDefinition(this, 'wp-app-task-def',{
      networkMode: ecs.NetworkMode.AWS_VPC,
    });

    const imageRepo = ecr.Repository.fromRepositoryName(this, 'Repo', 'wp_docker_image');
    const tag = process.env.BITBUCKET_BUILD_NUMBER;
    const image = ecs.ContainerImage.fromEcrRepository(imageRepo, tag)

    new cdk.CfnOutput(this, 'ecr-image', {
      value: image.imageName
    }); 

    const container = taskDefinition.addContainer('wp-container', {
      image: image,
      memoryLimitMiB: 1024,
      cpu: 512,
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: 'wp-app-log', 
        logRetention: 30,
      }),
      environment: { 
        'WORDPRESS_DB_HOST': rds_host.stringValue,
        'WORDPRESS_DB_USER' : rds_username.stringValue,
        'WORDPRESS_DB_PASSWORD': rds_password.stringValue,
        'WORDPRESS_DB_NAME': 'wp_db',
      },
      healthCheck: {
        command: [ "CMD-SHELL", "curl -f http://localhost/license.txt || exit 1" ],
      },
    });

    container.addPortMappings({
      containerPort: 80
    });
  
    //ECS service
    const sg_service = new ec2.SecurityGroup(this, 'wp-app-ecs-sg', { vpc: vpc });
    sg_service.addIngressRule(ec2.Peer.ipv4('0.0.0.0/0'), ec2.Port.tcp(80));
    sg_service.addIngressRule(ec2.Peer.ipv4('0.0.0.0/0'), ec2.Port.tcp(443));

    const service = new ecs.Ec2Service(this, 'wp-app-ecs-svc', { 
      cluster: cluster, 
      taskDefinition: taskDefinition,
      desiredCount: 2,
      securityGroups: [sg_service],
     });

    // ALB configs
    const albsg = new ec2.SecurityGroup(this, 'wp-app-alb-sg', {
      vpc: vpc,
      description: 'allow 80 and 443',
      allowAllOutbound: true,
    });
    albsg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'allow 80 inbound');
    albsg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'allow 443 inbound');

    const lb = new elbv2.ApplicationLoadBalancer(this, 'wp-app-alb', {
      vpc: vpc,
      internetFacing: true,
      securityGroup: albsg,
    });

    const listener = lb.addListener('Listener', {
      port: 80,
      open: true,
    });

    listener.addTargets('Target', {
      port: 80,
      targets: [service],
      healthCheck: { 
        path: '/license.txt', // previuos value -> '/wp-admin/setup-config.php',
        port: '80',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(15),
        unhealthyThresholdCount: 5,
        healthyThresholdCount: 2,
      }
    });

  }
}
